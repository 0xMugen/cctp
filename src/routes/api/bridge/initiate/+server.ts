import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cctpService } from '$lib/server/cctp/service.js';

/**
 * POST /api/bridge/initiate
 * Initiate a new bridge transaction
 *
 * Body:
 * - sourceDomain: Source chain domain ID
 * - destDomain: Destination chain domain ID
 * - amount: Amount in smallest unit (e.g., 1000000 for 1 USDC)
 * - sender: Sender's address on source chain
 * - recipient: Recipient's address on destination chain
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { sourceDomain, destDomain, amount, sender, recipient, isFastTransfer } = body;

		// Validate required fields
		if (
			sourceDomain === undefined ||
			destDomain === undefined ||
			!amount ||
			!sender ||
			!recipient
		) {
			return json(
				{ error: 'Missing required fields: sourceDomain, destDomain, amount, sender, recipient' },
				{ status: 400 }
			);
		}

		// Validate amount is a valid number string
		try {
			BigInt(amount);
		} catch {
			return json({ error: 'Invalid amount: must be a valid integer string' }, { status: 400 });
		}

		const result = await cctpService.initiateBridge({
			userAddress: sender,
			sourceDomain: parseInt(sourceDomain),
			destDomain: parseInt(destDomain),
			amount: amount.toString(),
			recipientAddress: recipient,
			isFastTransfer: isFastTransfer !== false
		});

		return json({
			bridgeId: result.bridgeId,
			txData: result.txData
		});
	} catch (error) {
		console.error('Error initiating bridge:', error);
		const message = error instanceof Error ? error.message : 'Failed to initiate bridge';
		return json({ error: message }, { status: 400 });
	}
};
