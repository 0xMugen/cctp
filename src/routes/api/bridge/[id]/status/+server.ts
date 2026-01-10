import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cctpService } from '$lib/server/cctp/service.js';

/**
 * GET /api/bridge/[id]/status
 * Get the status of a bridge transaction
 *
 * Returns:
 * - transaction: Full transaction details
 * - mintTxData: Transaction data for minting (if attestation is ready)
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const { id } = params;

		const result = await cctpService.getTransactionStatus(id);

		if (!result) {
			return json({ error: 'Bridge transaction not found' }, { status: 404 });
		}

		const { transaction, mintTxData } = result;

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
			// Include mint transaction data if attestation is ready
			mintTxData: mintTxData || null
		});
	} catch (error) {
		console.error('Error getting bridge status:', error);
		const message = error instanceof Error ? error.message : 'Failed to get bridge status';
		return json({ error: message }, { status: 400 });
	}
};
