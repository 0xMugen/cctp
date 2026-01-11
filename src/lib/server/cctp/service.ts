import { db } from '../db.js';
import {
	getChainConfig,
	getSupportedChains,
	isValidBridgePair,
	STARKNET_DOMAIN_ID,
	type ChainConfig
} from './config.js';
import { fetchAttestation, computeMessageHash, getTransferFees, getMessageFromTx } from './attestation.js';
import { buildDepositForBurnTx, buildReceiveMessageTx, getApprovalTxData, type DepositForBurnParams } from './evm.js';
import { buildStarknetBurnMulticall, buildStarknetMintCall } from './starknet.js';
import { buildSolanaBurnInstruction, buildSolanaMintInstruction } from './solana.js';
import type { Hex, Address } from 'viem';
import type { Call } from 'starknet';

// Bridge transaction status
export type BridgeStatus =
	| 'initiated'
	| 'burned'
	| 'attested'
	| 'minting'
	| 'completed'
	| 'failed';
export type AttestationStatus = 'pending' | 'complete' | 'failed';

export interface BridgeTransaction {
	id: string;
	userAddress: string;
	sourceDomainId: number;
	destDomainId: number;
	amount: string;
	recipientAddress: string;
	burnTxHash: string | null;
	messageHash: string | null;
	messageBytes: string | null;
	nonce: string | null;
	attestation: string | null;
	attestationStatus: AttestationStatus;
	attestationAttempts: number;
	mintTxHash: string | null;
	status: BridgeStatus;
	errorMessage: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface InitiateBridgeParams {
	userAddress: string;
	sourceDomain: number;
	destDomain: number;
	amount: string;
	recipientAddress: string;
}

export interface BurnTxData {
	// For EVM chains
	evm?: {
		to: Address;
		data: Hex;
		chainId: number;
	};
	// EVM approve transaction (if user needs to approve TokenMessenger)
	evmApprove?: {
		to: Address;
		data: Hex;
		chainId: number;
	};
	// For Starknet
	starknet?: {
		calls: Call[];
	};
	// For Solana
	solana?: {
		instructions: Array<{
			programId: string;
			keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
			data: string;
		}>;
	};
}

export interface MintTxData {
	evm?: {
		to: Address;
		data: Hex;
		chainId: number;
	};
	starknet?: {
		calls: Call[];
	};
	solana?: {
		instructions: Array<{
			programId: string;
			keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
			data: string;
		}>;
	};
}

/**
 * Main CCTP Bridge Service
 */
export class CCTPService {
	/**
	 * Get supported chains for bridging
	 */
	getChains(): ChainConfig[] {
		return getSupportedChains();
	}

	/**
	 * Get a quote for a bridge transfer
	 */
	async getQuote(
		sourceDomain: number,
		destDomain: number,
		amount: string
	): Promise<{
		fee: string;
		estimatedTime: string;
		rate: string;
	}> {
		if (!isValidBridgePair(sourceDomain, destDomain)) {
			throw new Error('Invalid bridge pair: must involve Starknet');
		}

		// Get fees from Circle API
		const fees = await getTransferFees();

		// Calculate fee based on amount
		const amountBigInt = BigInt(amount);
		const feeAmount = (amountBigInt * BigInt(fees.minimumFee)) / BigInt(10000); // minimumFee is in bps

		return {
			fee: feeAmount.toString(),
			estimatedTime: '30 seconds', // V2 Fast Transfer
			rate: '1:1' // USDC is 1:1 across chains
		};
	}

	/**
	 * Initiate a new bridge transaction
	 * Returns the bridge ID and transaction data for signing
	 */
	async initiateBridge(params: InitiateBridgeParams): Promise<{
		bridgeId: string;
		txData: BurnTxData;
	}> {
		// Validate bridge pair
		if (!isValidBridgePair(params.sourceDomain, params.destDomain)) {
			throw new Error('Invalid bridge pair: must involve Starknet');
		}

		// Validate chains exist
		const sourceConfig = getChainConfig(params.sourceDomain);
		const destConfig = getChainConfig(params.destDomain);

		if (!sourceConfig || !destConfig) {
			throw new Error('Invalid source or destination domain');
		}

		// Create bridge transaction record
		const result = await db.execute<{ id: string }>(
			`INSERT INTO bridge_transactions (
				user_address, source_domain_id, dest_domain_id, amount, recipient_address, status, attestation_status
			) VALUES ($1, $2, $3, $4, $5, 'initiated', 'pending')
			RETURNING id`,
			[
				params.userAddress,
				params.sourceDomain,
				params.destDomain,
				params.amount,
				params.recipientAddress
			]
		);

		const bridgeId = result[0].id;

		// Build transaction data based on source chain type
		const txData = this.buildBurnTxData(sourceConfig, {
			amount: BigInt(params.amount),
			destinationDomain: params.destDomain,
			mintRecipient: params.recipientAddress,
			burnToken: sourceConfig.usdc as Address,
			userAddress: params.userAddress
		});

		return { bridgeId, txData };
	}

	/**
	 * Record a burn transaction and start attestation polling
	 */
	async recordBurnTx(
		bridgeId: string,
		txHash: string,
		messageBytes?: string,
		nonce?: string
	): Promise<void> {
		const tx = await this.getTransaction(bridgeId);
		if (!tx) {
			throw new Error('Bridge transaction not found');
		}

		let finalMessageBytes = messageBytes;
		let finalNonce = nonce;
		let messageHash: string | null = null;

		if (!finalMessageBytes) {
			try {
				const messageData = await getMessageFromTx(tx.sourceDomainId, txHash);
				if (messageData) {
					finalMessageBytes = messageData.message;
					finalNonce = messageData.eventNonce;
					console.log(`Fetched message from Circle API for tx ${txHash}`);
				}
			} catch (error) {
				// Message may not be available yet - will be retried by attestation worker
				console.log(`Message not yet available for tx ${txHash}, will retry later`);
			}
		}

		if (finalMessageBytes) {
			messageHash = computeMessageHash(finalMessageBytes);
		}

		await db.execute(
			`UPDATE bridge_transactions
			 SET burn_tx_hash = $1, message_bytes = $2, message_hash = $3, nonce = $4,
			     status = 'burned', updated_at = NOW()
			 WHERE id = $5`,
			[txHash, finalMessageBytes || null, messageHash, finalNonce || null, bridgeId]
		);
	}

	/**
	 * Get the status of a bridge transaction
	 */
	async getTransaction(bridgeId: string): Promise<BridgeTransaction | null> {
		const result = await db.execute<BridgeTransaction>(
			`SELECT
				id, user_address as "userAddress", source_domain_id as "sourceDomainId",
				dest_domain_id as "destDomainId", amount, recipient_address as "recipientAddress",
				burn_tx_hash as "burnTxHash", message_hash as "messageHash",
				message_bytes as "messageBytes", nonce, attestation,
				attestation_status as "attestationStatus", attestation_attempts as "attestationAttempts",
				mint_tx_hash as "mintTxHash", status, error_message as "errorMessage",
				created_at as "createdAt", updated_at as "updatedAt"
			 FROM bridge_transactions WHERE id = $1`,
			[bridgeId]
		);

		return result[0] || null;
	}

	/**
	 * Get transaction status with mint transaction data if attestation is ready
	 */
	async getTransactionStatus(bridgeId: string): Promise<{
		transaction: BridgeTransaction;
		mintTxData?: MintTxData;
	} | null> {
		const tx = await this.getTransaction(bridgeId);
		if (!tx) return null;

		// If attestation is ready, build mint transaction data
		let mintTxData: MintTxData | undefined;
		if (tx.attestation && tx.messageBytes) {
			const destConfig = getChainConfig(tx.destDomainId);
			if (destConfig) {
				mintTxData = this.buildMintTxData(destConfig, tx.messageBytes, tx.attestation);
			}
		}

		return { transaction: tx, mintTxData };
	}

	/**
	 * Check and update attestation for a transaction
	 */
	async checkAttestation(bridgeId: string): Promise<string | null> {
		let tx = await this.getTransaction(bridgeId);
		if (!tx) return null;

		if (tx.attestationStatus === 'complete' || tx.status === 'completed') {
			return tx.attestation;
		}

		// keccak256 of empty data - this is an invalid message hash
		const EMPTY_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
		const hasValidMessageHash = tx.messageHash && tx.messageHash !== EMPTY_HASH;

		if (!hasValidMessageHash && tx.burnTxHash) {
			try {
				const messageData = await getMessageFromTx(tx.sourceDomainId, tx.burnTxHash);
				if (messageData) {
					const messageHash = computeMessageHash(messageData.message);

					if (messageData.attestation) {
						await db.execute(
							`UPDATE bridge_transactions
							 SET message_bytes = $1, message_hash = $2, nonce = $3,
							     attestation = $4, attestation_status = 'complete', status = 'attested',
							     updated_at = NOW()
							 WHERE id = $5`,
							[messageData.message, messageHash, messageData.eventNonce, messageData.attestation, bridgeId]
						);
						console.log(`[CCTP] Got message AND attestation for tx ${tx.burnTxHash}`);
						return messageData.attestation;
					} else {
						await db.execute(
							`UPDATE bridge_transactions
							 SET message_bytes = $1, message_hash = $2, nonce = $3, updated_at = NOW()
							 WHERE id = $4`,
							[messageData.message, messageHash, messageData.eventNonce, bridgeId]
						);
						tx = await this.getTransaction(bridgeId);
						if (!tx) return null;
						console.log(`[CCTP] Fetched message for tx ${tx.burnTxHash}, hash: ${messageHash}`);
					}
				}
			} catch (error) {
				console.log(`[CCTP] Message not yet available for bridge ${bridgeId}:`, error);
				return null;
			}
		}

		// Still no valid message hash - can't check attestation via V1 API
		if (!tx.messageHash || tx.messageHash === EMPTY_HASH) {
			return null;
		}

		try {
			const attestation = await fetchAttestation(tx.messageHash);

			if (attestation) {
				await db.execute(
					`UPDATE bridge_transactions
					 SET attestation = $1, attestation_status = 'complete', status = 'attested',
					     attestation_attempts = attestation_attempts + 1, last_attestation_check = NOW(),
					     updated_at = NOW()
					 WHERE id = $2`,
					[attestation, bridgeId]
				);
				return attestation;
			} else {
				// Update attempt count
				await db.execute(
					`UPDATE bridge_transactions
					 SET attestation_attempts = attestation_attempts + 1, last_attestation_check = NOW()
					 WHERE id = $1`,
					[bridgeId]
				);
				return null;
			}
		} catch (error) {
			console.error(`Error checking attestation for ${bridgeId}:`, error);
			return null;
		}
	}

	/**
	 * Record a mint transaction completion
	 */
	async recordMintTx(bridgeId: string, txHash: string): Promise<void> {
		await db.execute(
			`UPDATE bridge_transactions
			 SET mint_tx_hash = $1, status = 'completed', updated_at = NOW()
			 WHERE id = $2`,
			[txHash, bridgeId]
		);
	}

	/**
	 * Mark a transaction as failed
	 */
	async markFailed(bridgeId: string, errorMessage: string): Promise<void> {
		await db.execute(
			`UPDATE bridge_transactions
			 SET status = 'failed', error_message = $1, updated_at = NOW()
			 WHERE id = $2`,
			[errorMessage, bridgeId]
		);
	}

	/**
	 * Get all pending attestations for polling
	 * Includes transactions without message_hash - checkAttestation will fetch it
	 */
	async getPendingAttestations(): Promise<BridgeTransaction[]> {
		return db.execute<BridgeTransaction>(
			`SELECT
				id, user_address as "userAddress", source_domain_id as "sourceDomainId",
				dest_domain_id as "destDomainId", amount, recipient_address as "recipientAddress",
				burn_tx_hash as "burnTxHash", message_hash as "messageHash",
				message_bytes as "messageBytes", nonce, attestation,
				attestation_status as "attestationStatus", attestation_attempts as "attestationAttempts",
				mint_tx_hash as "mintTxHash", status, error_message as "errorMessage",
				created_at as "createdAt", updated_at as "updatedAt"
			 FROM bridge_transactions
			 WHERE attestation_status = 'pending'
			   AND status = 'burned'
			   AND burn_tx_hash IS NOT NULL
			   AND (last_attestation_check IS NULL OR last_attestation_check < NOW() - INTERVAL '5 seconds')
			 ORDER BY created_at ASC
			 LIMIT 100`,
			[]
		);
	}

	/**
	 * Get all transactions that are attested but not yet minted (for mint worker)
	 */
	async getPendingMints(): Promise<BridgeTransaction[]> {
		return db.execute<BridgeTransaction>(
			`SELECT
				id, user_address as "userAddress", source_domain_id as "sourceDomainId",
				dest_domain_id as "destDomainId", amount, recipient_address as "recipientAddress",
				burn_tx_hash as "burnTxHash", message_hash as "messageHash",
				message_bytes as "messageBytes", nonce, attestation,
				attestation_status as "attestationStatus", attestation_attempts as "attestationAttempts",
				mint_tx_hash as "mintTxHash", status, error_message as "errorMessage",
				created_at as "createdAt", updated_at as "updatedAt"
			 FROM bridge_transactions
			 WHERE status = 'attested'
			   AND attestation IS NOT NULL
			   AND attestation LIKE '0x%'
			   AND message_bytes IS NOT NULL
			   AND message_bytes LIKE '0x%'
			   AND mint_tx_hash IS NULL
			 ORDER BY created_at ASC
			 LIMIT 100`,
			[]
		);
	}

	/**
	 * Build burn transaction data based on source chain type
	 */
	private buildBurnTxData(
		sourceConfig: ChainConfig,
		params: DepositForBurnParams & { userAddress: string }
	): BurnTxData {
		switch (sourceConfig.type) {
			case 'evm': {
				const burnTx = buildDepositForBurnTx(sourceConfig.domainId, params);
				// Build approve transaction for USDC -> TokenMessenger (max approval for one-time approval)
				const MAX_UINT256 = 2n ** 256n - 1n;
				const approveData = getApprovalTxData(
					sourceConfig.usdc as Address,
					sourceConfig.tokenMessenger as Address,
					MAX_UINT256
				);
				return {
					evm: burnTx,
					evmApprove: {
						to: sourceConfig.usdc as Address,
						data: approveData,
						chainId: burnTx.chainId
					}
				};
			}

			case 'starknet':
				return {
					starknet: {
						calls: buildStarknetBurnMulticall({
							amount: params.amount,
							destinationDomain: params.destinationDomain,
							mintRecipient: params.mintRecipient
						})
					}
				};

			case 'solana': {
				const { instruction } = buildSolanaBurnInstruction({
					amount: params.amount,
					destinationDomain: params.destinationDomain,
					mintRecipient: params.mintRecipient,
					senderTokenAccount: params.userAddress, // Caller should provide token account
					sender: params.userAddress
				});
				return {
					solana: {
						instructions: [
							{
								programId: instruction.programId.toBase58(),
								keys: instruction.keys.map((k) => ({
									pubkey: k.pubkey.toBase58(),
									isSigner: k.isSigner,
									isWritable: k.isWritable
								})),
								data: instruction.data.toString('base64')
							}
						]
					}
				};
			}

			default:
				throw new Error(`Unsupported source chain type: ${sourceConfig.type}`);
		}
	}

	/**
	 * Build mint transaction data based on destination chain type
	 */
	private buildMintTxData(
		destConfig: ChainConfig,
		messageBytes: string,
		attestation: string
	): MintTxData {
		switch (destConfig.type) {
			case 'evm':
				return {
					evm: buildReceiveMessageTx(destConfig.domainId, messageBytes as Hex, attestation as Hex)
				};

			case 'starknet':
				return {
					starknet: {
						calls: [
							buildStarknetMintCall({
								message: messageBytes,
								attestation
							})
						]
					}
				};

			case 'solana': {
				const { instruction } = buildSolanaMintInstruction({
					message: Buffer.from(messageBytes.replace('0x', ''), 'hex'),
					attestation: Buffer.from(attestation.replace('0x', ''), 'hex'),
					recipient: '' // Caller should provide recipient
				});
				return {
					solana: {
						instructions: [
							{
								programId: instruction.programId.toBase58(),
								keys: instruction.keys.map((k) => ({
									pubkey: k.pubkey.toBase58(),
									isSigner: k.isSigner,
									isWritable: k.isWritable
								})),
								data: instruction.data.toString('base64')
							}
						]
					}
				};
			}

			default:
				throw new Error(`Unsupported destination chain type: ${destConfig.type}`);
		}
	}
}

// Export singleton instance
export const cctpService = new CCTPService();
