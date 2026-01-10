import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cctpService } from '$lib/server/cctp/service.js';

/**
 * POST /api/bridge/[id]/complete
 * Record the mint transaction hash and mark the bridge as completed
 *
 * Body:
 * - txHash: The mint transaction hash on the destination chain
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const { id } = params;
		const body = await request.json();
		const { txHash } = body;

		if (!txHash) {
			return json({ error: 'Missing required field: txHash' }, { status: 400 });
		}

		// Verify the transaction exists
		const tx = await cctpService.getTransaction(id);
		if (!tx) {
			return json({ error: 'Bridge transaction not found' }, { status: 404 });
		}

		// Check if attestation is ready
		if (!tx.attestation) {
			return json({ error: 'Attestation not yet available' }, { status: 400 });
		}

		// Check if already completed
		if (tx.status === 'completed') {
			return json({ error: 'Bridge already completed' }, { status: 400 });
		}

		// Record the mint transaction
		await cctpService.recordMintTx(id, txHash);

		return json({
			success: true,
			bridgeId: id,
			status: 'completed',
			message: 'Bridge completed successfully'
		});
	} catch (error) {
		console.error('Error completing bridge:', error);
		const message = error instanceof Error ? error.message : 'Failed to complete bridge';
		return json({ error: message }, { status: 400 });
	}
};
