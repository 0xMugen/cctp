import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db.js';
import { getChainConfig } from '$lib/server/app-config.js';
import { buildReceiveMessageTx } from '$lib/server/cctp/evm.js';
import { checkMessageDelivered } from '$lib/server/cctp/attestation.js';
import type { Hex } from 'viem';

interface ActivityTransaction {
	id: string;
	status: string;
	attestationStatus: string;
	sourceDomainId: number;
	destDomainId: number;
	amount: string;
	recipientAddress: string;
	burnTxHash: string | null;
	mintTxHash: string | null;
	messageBytes: string | null;
	attestation: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * GET /api/bridge/activity
 * Get transaction history for connected wallets
 *
 * Query params:
 * - addresses: comma-separated wallet addresses
 * - limit: max results (default 10)
 * - offset: pagination offset (default 0)
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const addressesParam = url.searchParams.get('addresses');
		const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);
		const offset = parseInt(url.searchParams.get('offset') || '0', 10);

		if (!addressesParam) {
			return json({ error: 'addresses parameter is required' }, { status: 400 });
		}

		// Parse comma-separated addresses and normalize
		// For EVM addresses (0x + 40 hex chars), convert to lowercase
		// For Starknet addresses (0x + 64 hex chars), keep as-is but also add lowercase version
		const rawAddresses = addressesParam
			.split(',')
			.map((a) => a.trim())
			.filter((a) => a.length > 0);

		// Normalize addresses - include both original and lowercase for case-insensitive matching
		const addresses = rawAddresses.flatMap((addr) => {
			const lower = addr.toLowerCase();
			if (lower !== addr) {
				return [addr, lower];
			}
			return [addr];
		});

		if (addresses.length === 0) {
			return json({ error: 'At least one address is required' }, { status: 400 });
		}

		// Build query with parameterized addresses
		// Match by user_address OR recipient_address to catch both initiated and received transfers
		// Use separate placeholder ranges for each IN clause
		const placeholders1 = addresses.map((_, i) => `$${i + 1}`).join(', ');
		const placeholders2 = addresses.map((_, i) => `$${i + 1 + addresses.length}`).join(', ');

		// Get total count (only transactions with burn_tx_hash - others are reverted/abandoned)
		const countResult = await db.execute<{ count: string }>(
			`SELECT COUNT(*) as count FROM bridge_transactions
			 WHERE (user_address IN (${placeholders1}) OR recipient_address IN (${placeholders2}))
			   AND burn_tx_hash IS NOT NULL`,
			[...addresses, ...addresses]
		);
		const total = parseInt(countResult[0]?.count || '0', 10);

		// Get transactions with pagination (only those with burn_tx_hash)
		const limitParam = addresses.length * 2 + 1;
		const offsetParam = addresses.length * 2 + 2;
		const transactions = await db.execute<ActivityTransaction>(
			`SELECT
				id, status, attestation_status as "attestationStatus",
				source_domain_id as "sourceDomainId", dest_domain_id as "destDomainId",
				amount, recipient_address as "recipientAddress",
				burn_tx_hash as "burnTxHash", mint_tx_hash as "mintTxHash",
				message_bytes as "messageBytes", attestation,
				created_at as "createdAt", updated_at as "updatedAt"
			 FROM bridge_transactions
			 WHERE (user_address IN (${placeholders1}) OR recipient_address IN (${placeholders2}))
			   AND burn_tx_hash IS NOT NULL
			 ORDER BY created_at DESC
			 LIMIT $${limitParam} OFFSET $${offsetParam}`,
			[...addresses, ...addresses, limit, offset]
		);

		// Build response with mintTxData for claimable transactions
		// Only check Circle auto-mint for non-completed Starknet destinations
		const enrichedTransactions = await Promise.all(
			transactions.map(async (tx) => {
				let status = tx.status;
				let mintTxHash = tx.mintTxHash;
				const destConfig = getChainConfig(tx.destDomainId);

				// For Starknet destinations with attested status (not completed), check if Circle auto-minted
				if (
					destConfig?.type === 'starknet' &&
					tx.status === 'attested' &&
					tx.burnTxHash &&
					!tx.mintTxHash // Only check if not already completed
				) {
					try {
						const { delivered } = await checkMessageDelivered(
							tx.sourceDomainId,
							tx.burnTxHash,
							true // isStarknetDest
						);
						if (delivered) {
							// Circle auto-minted - update DB and local status
							console.log(`[Activity] tx ${tx.id}: Circle auto-mint completed`);
							await db.execute(
								`UPDATE bridge_transactions SET status = 'completed', mint_tx_hash = 'auto-mint-by-circle', updated_at = NOW() WHERE id = $1`,
								[tx.id]
							);
							status = 'completed';
							mintTxHash = 'auto-mint-by-circle';
						}
					} catch (error) {
						console.error(`[Activity] Failed to check auto-mint for ${tx.id}:`, error);
					}
				}

				const result: Record<string, unknown> = {
					id: tx.id,
					status,
					attestationStatus: tx.attestationStatus,
					sourceDomainId: tx.sourceDomainId,
					destDomainId: tx.destDomainId,
					amount: tx.amount,
					recipientAddress: tx.recipientAddress,
					burnTxHash: tx.burnTxHash,
					mintTxHash,
					createdAt: tx.createdAt,
					updatedAt: tx.updatedAt
				};

				// Add mintTxData for claimable transactions (attested status + EVM destination only)
				if (
					status === 'attested' &&
					tx.attestation &&
					tx.messageBytes &&
					destConfig?.type === 'evm'
				) {
					try {
						const mintTxData = buildReceiveMessageTx(
							tx.destDomainId,
							tx.messageBytes as Hex,
							tx.attestation as Hex
						);
						result.mintTxData = { evm: mintTxData };
					} catch (error) {
						console.error(`Failed to build mintTxData for ${tx.id}:`, error);
					}
				}

				return result;
			})
		);

		return json({
			transactions: enrichedTransactions,
			total,
			hasMore: offset + transactions.length < total
		});
	} catch (error) {
		console.error('Error fetching activity:', error);
		const message = error instanceof Error ? error.message : 'Failed to fetch activity';
		return json({ error: message }, { status: 500 });
	}
};
