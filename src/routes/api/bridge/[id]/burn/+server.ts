import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cctpService } from '$lib/server/cctp/service.js';

/**
 * POST /api/bridge/[id]/burn
 * Record the burn transaction hash and start attestation polling
 *
 * Body:
 * - txHash: The burn transaction hash
 * - messageBytes?: The message bytes from the MessageSent event (optional, can be extracted from tx)
 * - nonce?: The nonce from the message (optional)
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const { id } = params;
		const body = await request.json();
		const { txHash, messageBytes, nonce } = body;

		if (!txHash) {
			return json({ error: 'Missing required field: txHash' }, { status: 400 });
		}

		// Verify the transaction exists
		const tx = await cctpService.getTransaction(id);
		if (!tx) {
			return json({ error: 'Bridge transaction not found' }, { status: 404 });
		}

		// Check if already recorded
		if (tx.burnTxHash) {
			return json({ error: 'Burn transaction already recorded' }, { status: 400 });
		}

		// Record the burn transaction
		await cctpService.recordBurnTx(id, txHash, messageBytes, nonce);

		return json({
			success: true,
			bridgeId: id,
			status: 'burned',
			message: 'Burn transaction recorded. Attestation polling started.'
		});
	} catch (error) {
		console.error('Error recording burn transaction:', error);
		const message = error instanceof Error ? error.message : 'Failed to record burn transaction';
		return json({ error: message }, { status: 400 });
	}
};
