import type { PoolClient } from 'pg';
import { pool } from '../database.js';
import { cctpService } from './service.js';
import { executeMint, isRelayerEnabled, findExistingMintTx } from './relayer.js';
import { getChainConfig } from './config.js';
import { parseNonceFromMessage } from './evm.js';
import type { Address, Hex } from 'viem';

interface MintJob {
	id: string;
	destDomainId: number;
	attempts: number;
	nextRetry: number;
}

/**
 * Event-driven mint worker using PostgreSQL LISTEN/NOTIFY
 * Executes mint transactions on destination chains after attestation is received
 */
class MintWorker {
	private jobs: Map<string, MintJob> = new Map();
	private client: PoolClient | null = null;
	private running = false;
	private processingTimer: ReturnType<typeof setTimeout> | null = null;

	// Exponential backoff configuration
	private readonly BASE_DELAY = 5000; // 5 seconds initial (longer than attestation since mints are expensive)
	private readonly MAX_DELAY = 300000; // 5 minutes max
	private readonly MAX_ATTEMPTS = 20; // ~1 hour total with backoff
	private readonly IDLE_CHECK_INTERVAL = 60000; // 1 minute when no jobs

	/**
	 * Start the mint worker
	 */
	async start(): Promise<void> {
		// Mint worker handles EVM destinations (Starknet uses Circle auto-mint)
		if (!isRelayerEnabled()) {
			console.log('Mint worker disabled: EVM relayer not configured (check RELAYER_ENABLED and RELAYER_PRIVATE_KEY)');
			console.log('Note: Starknet destinations use Circle auto-mint and do not require a relayer');
			return;
		}

		if (this.running) {
			console.log('Mint worker already running');
			return;
		}

		this.running = true;
		console.log('Starting mint worker (event-driven mode)');

		try {
			// Get dedicated connection for LISTEN
			this.client = await pool.connect();
			await this.client.query('LISTEN mint_needed');

			// Handle notifications
			this.client.on('notification', (msg) => {
				if (msg.channel === 'mint_needed' && msg.payload) {
					try {
						const data = JSON.parse(msg.payload);
						this.enqueueJob(data.id, data.dest_domain_id, 0);
					} catch (error) {
						console.error('Error parsing mint notification:', error);
					}
				}
			});

			// Handle connection errors
			this.client.on('error', (error) => {
				console.error('Mint worker connection error:', error);
				this.reconnect();
			});

			// Load existing pending mints on startup
			await this.loadPendingJobs();

			// Start processing loop
			this.scheduleProcessing();

			console.log(`Mint worker started with ${this.jobs.size} pending jobs`);
		} catch (error) {
			console.error('Failed to start mint worker:', error);
			this.running = false;
			throw error;
		}
	}

	/**
	 * Stop the mint worker
	 */
	async stop(): Promise<void> {
		if (!this.running) return;

		this.running = false;
		console.log('Stopping mint worker...');

		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
			this.processingTimer = null;
		}

		if (this.client) {
			try {
				await this.client.query('UNLISTEN mint_needed');
				this.client.release();
			} catch (error) {
				console.error('Error releasing mint worker connection:', error);
			}
			this.client = null;
		}

		console.log('Mint worker stopped');
	}

	/**
	 * Reconnect after connection loss
	 */
	private async reconnect(): Promise<void> {
		if (!this.running) return;

		console.log('Attempting to reconnect mint worker...');

		if (this.client) {
			try {
				this.client.release();
			} catch {
				// Ignore release errors
			}
			this.client = null;
		}

		// Wait before reconnecting
		await new Promise((resolve) => setTimeout(resolve, 5000));

		if (this.running) {
			try {
				this.client = await pool.connect();
				await this.client.query('LISTEN mint_needed');

				this.client.on('notification', (msg) => {
					if (msg.channel === 'mint_needed' && msg.payload) {
						try {
							const data = JSON.parse(msg.payload);
							this.enqueueJob(data.id, data.dest_domain_id, 0);
						} catch (error) {
							console.error('Error parsing mint notification:', error);
						}
					}
				});

				this.client.on('error', (error) => {
					console.error('Mint worker connection error:', error);
					this.reconnect();
				});

				console.log('Mint worker reconnected');
			} catch (error) {
				console.error('Failed to reconnect mint worker:', error);
				// Try again
				this.reconnect();
			}
		}
	}

	/**
	 * Load existing pending mints from database
	 */
	private async loadPendingJobs(): Promise<void> {
		try {
			const pending = await cctpService.getPendingMints();
			for (const tx of pending) {
				this.enqueueJob(tx.id, tx.destDomainId, 0);
			}
		} catch (error) {
			console.error('Error loading pending mints:', error);
		}
	}

	/**
	 * Add a job to the queue
	 */
	private enqueueJob(id: string, destDomainId: number, attempts: number): void {
		// Don't add if already exists
		if (this.jobs.has(id)) {
			return;
		}

		const delay = this.calculateBackoff(attempts);
		this.jobs.set(id, {
			id,
			destDomainId,
			attempts,
			nextRetry: Date.now() + delay
		});

		console.log(`Enqueued mint job ${id} for domain ${destDomainId} (attempt ${attempts}, next retry in ${delay}ms)`);

		// Reschedule processing if this job should run sooner
		this.scheduleProcessing();
	}

	/**
	 * Calculate exponential backoff with jitter
	 */
	private calculateBackoff(attempts: number): number {
		// Exponential backoff: 5s * 2^attempts, capped at 5 minutes
		const exponentialDelay = Math.min(this.BASE_DELAY * Math.pow(2, attempts), this.MAX_DELAY);
		// Add jitter (0-30% of delay) to prevent thundering herd
		const jitter = Math.random() * 0.3 * exponentialDelay;
		return Math.floor(exponentialDelay + jitter);
	}

	/**
	 * Schedule the next processing run
	 */
	private scheduleProcessing(): void {
		if (!this.running) return;

		// Clear existing timer
		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
		}

		const nextJob = this.getNextJob();
		if (!nextJob) {
			// No jobs, check again in 1 minute for any missed notifications
			this.processingTimer = setTimeout(() => {
				this.loadPendingJobs().then(() => this.scheduleProcessing());
			}, this.IDLE_CHECK_INTERVAL);
			return;
		}

		const delay = Math.max(0, nextJob.nextRetry - Date.now());
		this.processingTimer = setTimeout(() => this.processJobs(), delay);
	}

	/**
	 * Get the job with the earliest nextRetry time
	 */
	private getNextJob(): MintJob | null {
		let earliest: MintJob | null = null;
		for (const job of this.jobs.values()) {
			if (!earliest || job.nextRetry < earliest.nextRetry) {
				earliest = job;
			}
		}
		return earliest;
	}

	/**
	 * Process all ready jobs
	 */
	private async processJobs(): Promise<void> {
		if (!this.running) return;

		const now = Date.now();
		const readyJobs = Array.from(this.jobs.values())
			.filter((job) => job.nextRetry <= now)
			.slice(0, 3); // Process max 3 at a time (mints are more resource-intensive)

		if (readyJobs.length > 0) {
			console.log(`Processing ${readyJobs.length} mint jobs`);

			// Process sequentially to avoid nonce issues
			for (const job of readyJobs) {
				await this.processJob(job);
			}
		}

		// Schedule next run
		this.scheduleProcessing();
	}

	/**
	 * Process a single mint job
	 */
	private async processJob(job: MintJob): Promise<void> {
		// Store transaction info for recovery in case of errors
		let transactionInfo: {
			messageBytes: string;
			messageTransmitter: Address;
		} | null = null;

		try {
			// Get transaction details
			const result = await cctpService.getTransactionStatus(job.id);
			if (!result) {
				console.error(`[Mint] Transaction ${job.id} not found, removing from queue`);
				this.jobs.delete(job.id);
				return;
			}

			const { transaction, mintTxData } = result;

			// Check if already completed
			if (transaction.status === 'completed') {
				console.log(`[Mint] Transaction ${job.id} already completed, removing from queue`);
				this.jobs.delete(job.id);
				return;
			}

			// Check if failed
			if (transaction.status === 'failed') {
				console.log(`[Mint] Transaction ${job.id} is failed, removing from queue`);
				this.jobs.delete(job.id);
				return;
			}

			// Get destination chain config for routing
			const destConfig = getChainConfig(job.destDomainId);
			if (!destConfig) {
				console.error(`[Mint] Unknown destination domain ${job.destDomainId}, removing from queue`);
				this.jobs.delete(job.id);
				return;
			}

			// Route based on destination chain type
			if (destConfig.type === 'evm') {
				// EVM destination - check for EVM mint data
				if (!mintTxData?.evm) {
					console.log(`[Mint] No EVM mint data for ${job.id}, skipping`);
					this.jobs.delete(job.id);
					return;
				}

				if (!isRelayerEnabled()) {
					console.log(`[Mint] EVM relayer not configured for ${job.id}, skipping`);
					this.jobs.delete(job.id);
					return;
				}

				// Store info needed for recovery
				if (transaction.messageBytes) {
					transactionInfo = {
						messageBytes: transaction.messageBytes,
						messageTransmitter: mintTxData.evm.to as Address
					};
				}

				const { to, data } = mintTxData.evm;

				// Execute the EVM mint
				const { txHash, success } = await executeMint(
					job.destDomainId,
					to as Address,
					data as Hex
				);

				if (success) {
					await cctpService.recordMintTx(job.id, txHash);
					this.jobs.delete(job.id);
					console.log(`✅ EVM mint completed for ${job.id}: ${txHash}`);
				} else {
					job.attempts++;
					if (job.attempts >= this.MAX_ATTEMPTS) {
						this.jobs.delete(job.id);
						await cctpService.markFailed(
							job.id,
							`EVM mint transaction reverted after ${this.MAX_ATTEMPTS} attempts`
						);
						console.error(`❌ EVM mint failed for ${job.id}: max attempts reached`);
					} else {
						job.nextRetry = Date.now() + this.calculateBackoff(job.attempts);
						console.warn(
							`[Mint] EVM transaction reverted for ${job.id}, will retry (attempt ${job.attempts})`
						);
					}
				}
			} else if (destConfig.type === 'starknet') {
				// Starknet destinations use Circle's auto-mint (subsidized)
				// No need for our relayer - just skip and let Circle handle it
				console.log(`[Mint] Starknet destination for ${job.id} - Circle auto-mint handles this, skipping`);
				this.jobs.delete(job.id);
				return;
			} else {
				// Unsupported chain type (e.g., Solana)
				console.log(
					`[Mint] Chain type '${destConfig.type}' not yet supported for ${job.id}, skipping`
				);
				this.jobs.delete(job.id);
				return;
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			const errorMsgLower = errorMsg.toLowerCase();
			console.error(`Error processing mint for ${job.id}:`, error);

			// Check for "nonce already used" type errors
			// This means the mint was already executed on-chain but we failed to record it
			const isNonceError =
				errorMsgLower.includes('nonce already used') ||
				errorMsgLower.includes('already processed') ||
				errorMsgLower.includes('message already received');

			if (isNonceError && transactionInfo) {
				console.log(`[Mint] Detected nonce/message reuse for ${job.id}, attempting recovery...`);

				try {
					const { sourceDomain, nonce } = parseNonceFromMessage(
						transactionInfo.messageBytes as Hex
					);

					let existingTxHash: string | null = null;
					const destConfig = getChainConfig(job.destDomainId);

					// Try to find the existing mint transaction (EVM only - Starknet uses Circle auto-mint)
					if (destConfig?.type === 'evm') {
						existingTxHash = await findExistingMintTx(
							job.destDomainId,
							transactionInfo.messageTransmitter,
							sourceDomain,
							nonce
						);
					}

					if (existingTxHash) {
						// Found it! Record and complete
						await cctpService.recordMintTx(job.id, existingTxHash);
						this.jobs.delete(job.id);
						console.log(`✅ Recovered existing mint for ${job.id}: ${existingTxHash}`);
						return;
					}

					// Couldn't find the tx in recent blocks, but nonce is definitely used
					// Mark as completed with a placeholder hash since the mint did happen
					const placeholderHash = `0x${'0'.repeat(64)}` as Hex;
					await cctpService.recordMintTx(job.id, placeholderHash);
					this.jobs.delete(job.id);
					console.log(
						`✅ Mint already executed for ${job.id} (nonce used on-chain, tx not found in recent blocks)`
					);
					return;
				} catch (recoveryError) {
					console.error(`[Mint] Recovery failed for ${job.id}:`, recoveryError);
				}
			}

			// Retry with backoff on error
			job.attempts++;
			if (job.attempts >= this.MAX_ATTEMPTS) {
				this.jobs.delete(job.id);
				await cctpService.markFailed(job.id, `Mint failed: ${errorMsg}`);
				console.error(`❌ Mint failed for ${job.id}: ${errorMsg}`);
			} else {
				job.nextRetry = Date.now() + this.calculateBackoff(job.attempts);
			}
		}
	}

	/**
	 * Get current worker status
	 */
	getStatus(): { running: boolean; pendingJobs: number; jobs: MintJob[] } {
		return {
			running: this.running,
			pendingJobs: this.jobs.size,
			jobs: Array.from(this.jobs.values())
		};
	}
}

// Export singleton instance
export const mintWorker = new MintWorker();
