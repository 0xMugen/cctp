import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cctpService } from '$lib/server/cctp/service.js';
import { getChainConfig } from '$lib/server/app-config.js';
import { checkMessageDelivered } from '$lib/server/cctp/attestation.js';

/**
 * Check if mint will be handled automatically (by Circle auto-mint)
 * Only Starknet has subsidized auto-mint - EVM requires manual claim by user
 */
function willAutoMint(destDomainId: number): boolean {
	const destConfig = getChainConfig(destDomainId);
	if (!destConfig) return false;

	// Starknet has Circle-subsidized auto-mint in CCTP V2
	return destConfig.type === 'starknet';
}

/**
 * GET /api/bridge/[id]/status
 * Get the status of a bridge transaction
 *
 * Returns:
 * - transaction: Full transaction details
 * - mintTxData: Transaction data for minting (if attestation is ready)
 * - relayerWillMint: Whether the relayer will automatically execute the mint
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const { id } = params;

		let result = await cctpService.getTransactionStatus(id);

		if (!result) {
			return json({ error: 'Bridge transaction not found' }, { status: 404 });
		}

		let { transaction, mintTxData } = result;
		const destConfig = getChainConfig(transaction.destDomainId);
		const relayerWillMint = willAutoMint(transaction.destDomainId);

		if (transaction.status !== 'completed' && transaction.status !== 'failed') {
			if (transaction.status === 'burned' && transaction.burnTxHash) {
				const attestation = await cctpService.checkAttestation(id);
				if (attestation) {
					result = await cctpService.getTransactionStatus(id);
					if (result) {
						transaction = result.transaction;
						mintTxData = result.mintTxData;
					}
				}
			}

			if (
				destConfig?.type === 'starknet' &&
				transaction.status === 'attested' &&
				transaction.burnTxHash
			) {
				const { delivered } = await checkMessageDelivered(
					transaction.sourceDomainId,
					transaction.burnTxHash,
					true // isStarknetDest
				);

				if (delivered) {
					// Circle auto-minted - mark as completed
					console.log(`[Status] Circle auto-mint completed for ${id}`);
					await cctpService.recordMintTx(id, 'auto-mint-by-circle');
					// Refresh transaction status
					result = await cctpService.getTransactionStatus(id);
					if (result) {
						transaction = result.transaction;
					}
				}
			}
		}

		return json({
			bridgeId: transaction.id,
			status: transaction.status,
			attestationStatus: transaction.attestationStatus,
			sourceDomain: transaction.sourceDomainId,
			destDomain: transaction.destDomainId,
			amount: transaction.amount,
			recipientAddress: transaction.recipientAddress,
			burnTxHash: transaction.burnTxHash,
			mintTxHash: transaction.mintTxHash,
			attestation: transaction.attestation,
			errorMessage: transaction.errorMessage,
			createdAt: transaction.createdAt,
			updatedAt: transaction.updatedAt,
			// Include mint transaction data if attestation is ready (only needed if relayer won't mint)
			mintTxData: relayerWillMint ? null : mintTxData || null,
			// Flag indicating relayer will handle mint automatically
			relayerWillMint
		});
	} catch (error) {
		console.error('Error getting bridge status:', error);
		const message = error instanceof Error ? error.message : 'Failed to get bridge status';
		return json({ error: message }, { status: 400 });
	}
};
