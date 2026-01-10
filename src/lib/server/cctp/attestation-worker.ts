import type { PoolClient } from 'pg';
import { pool } from '../database.js';
import { cctpService } from './service.js';

interface AttestationJob {
	id: string;
	messageHash: string;
	attempts: number;
	nextRetry: number;
}

/**
 * Event-driven attestation worker using PostgreSQL LISTEN/NOTIFY
 * Replaces naive setInterval polling with exponential backoff
 */
class AttestationWorker {
	private jobs: Map<string, AttestationJob> = new Map();
	private client: PoolClient | null = null;
	private running = false;
	private processingTimer: ReturnType<typeof setTimeout> | null = null;

	// Exponential backoff configuration
	private readonly BASE_DELAY = 2000; // 2 seconds initial
	private readonly MAX_DELAY = 60000; // 1 minute max
	private readonly MAX_ATTEMPTS = 120; // ~20 minutes total with backoff
	private readonly IDLE_CHECK_INTERVAL = 30000; // 30 seconds when no jobs

	/**
	 * Start the attestation worker
	 */
	async start(): Promise<void> {
		if (this.running) {
			console.log('Attestation worker already running');
			return;
		}

		this.running = true;
		console.log('Starting attestation worker (event-driven mode)');

		try {
			// Get dedicated connection for LISTEN
			this.client = await pool.connect();
			await this.client.query('LISTEN attestation_needed');

			// Handle notifications
			this.client.on('notification', (msg) => {
				if (msg.channel === 'attestation_needed' && msg.payload) {
					try {
						const data = JSON.parse(msg.payload);
						this.enqueueJob(data.id, data.message_hash, data.attempts || 0);
					} catch (error) {
						console.error('Error parsing attestation notification:', error);
					}
				}
			});

			// Handle connection errors
			this.client.on('error', (error) => {
				console.error('Attestation worker connection error:', error);
				this.reconnect();
			});

			// Load existing pending attestations on startup
			await this.loadPendingJobs();

			// Start processing loop
			this.scheduleProcessing();

			console.log(`Attestation worker started with ${this.jobs.size} pending jobs`);
		} catch (error) {
			console.error('Failed to start attestation worker:', error);
			this.running = false;
			throw error;
		}
	}

	/**
	 * Stop the attestation worker
	 */
	async stop(): Promise<void> {
		if (!this.running) return;

		this.running = false;
		console.log('Stopping attestation worker...');

		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
			this.processingTimer = null;
		}

		if (this.client) {
			try {
				await this.client.query('UNLISTEN attestation_needed');
				this.client.release();
			} catch (error) {
				console.error('Error releasing attestation worker connection:', error);
			}
			this.client = null;
		}

		console.log('Attestation worker stopped');
	}

	/**
	 * Reconnect after connection loss
	 */
	private async reconnect(): Promise<void> {
		if (!this.running) return;

		console.log('Attempting to reconnect attestation worker...');

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
				await this.client.query('LISTEN attestation_needed');

				this.client.on('notification', (msg) => {
					if (msg.channel === 'attestation_needed' && msg.payload) {
						try {
							const data = JSON.parse(msg.payload);
							this.enqueueJob(data.id, data.message_hash, data.attempts || 0);
						} catch (error) {
							console.error('Error parsing attestation notification:', error);
						}
					}
				});

				this.client.on('error', (error) => {
					console.error('Attestation worker connection error:', error);
					this.reconnect();
				});

				console.log('Attestation worker reconnected');
			} catch (error) {
				console.error('Failed to reconnect attestation worker:', error);
				// Try again
				this.reconnect();
			}
		}
	}

	/**
	 * Load existing pending attestations from database
	 */
	private async loadPendingJobs(): Promise<void> {
		try {
			const pending = await cctpService.getPendingAttestations();
			for (const tx of pending) {
				this.enqueueJob(tx.id, tx.messageHash || '', tx.attestationAttempts);
			}
		} catch (error) {
			console.error('Error loading pending attestations:', error);
		}
	}

	/**
	 * Add a job to the queue
	 */
	private enqueueJob(id: string, messageHash: string, attempts: number): void {
		// Don't add if already exists
		if (this.jobs.has(id)) {
			return;
		}

		const delay = this.calculateBackoff(attempts);
		this.jobs.set(id, {
			id,
			messageHash,
			attempts,
			nextRetry: Date.now() + delay
		});

		console.log(`Enqueued attestation job ${id} (attempt ${attempts}, next retry in ${delay}ms)`);

		// Reschedule processing if this job should run sooner
		this.scheduleProcessing();
	}

	/**
	 * Calculate exponential backoff with jitter
	 */
	private calculateBackoff(attempts: number): number {
		// Exponential backoff: 2s * 1.5^attempts, capped at 1 minute
		const exponentialDelay = Math.min(this.BASE_DELAY * Math.pow(1.5, attempts), this.MAX_DELAY);
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
			// No jobs, check again in 30 seconds for any missed notifications
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
	private getNextJob(): AttestationJob | null {
		let earliest: AttestationJob | null = null;
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
			.slice(0, 10); // Process max 10 at a time to avoid overwhelming the API

		if (readyJobs.length > 0) {
			console.log(`Processing ${readyJobs.length} attestation jobs`);

			// Process in parallel
			await Promise.allSettled(readyJobs.map((job) => this.processJob(job)));
		}

		// Schedule next run
		this.scheduleProcessing();
	}

	/**
	 * Process a single attestation job
	 */
	private async processJob(job: AttestationJob): Promise<void> {
		try {
			const attestation = await cctpService.checkAttestation(job.id);

			if (attestation) {
				// Success! Remove from queue
				this.jobs.delete(job.id);
				console.log(`✅ Attestation received for ${job.id}`);
			} else {
				// Not ready yet, update for retry
				job.attempts++;

				if (job.attempts >= this.MAX_ATTEMPTS) {
					// Max attempts reached, mark as failed
					this.jobs.delete(job.id);
					await cctpService.markFailed(
						job.id,
						`Attestation timeout after ${this.MAX_ATTEMPTS} attempts`
					);
					console.error(`❌ Attestation timeout for ${job.id}`);
				} else {
					// Schedule retry with backoff
					job.nextRetry = Date.now() + this.calculateBackoff(job.attempts);
				}
			}
		} catch (error) {
			console.error(`Error checking attestation for ${job.id}:`, error);

			// Retry with backoff on error
			job.attempts++;
			job.nextRetry = Date.now() + this.calculateBackoff(job.attempts);
		}
	}

	/**
	 * Get current worker status
	 */
	getStatus(): { running: boolean; pendingJobs: number; jobs: AttestationJob[] } {
		return {
			running: this.running,
			pendingJobs: this.jobs.size,
			jobs: Array.from(this.jobs.values())
		};
	}
}

// Export singleton instance
export const attestationWorker = new AttestationWorker();
