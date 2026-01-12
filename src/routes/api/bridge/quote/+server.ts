import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cctpService } from '$lib/server/cctp/service.js';

/**
 * GET /api/bridge/quote
 * Get a quote for a bridge transfer
 *
 * Query params:
 * - sourceDomain: Source chain domain ID
 * - destDomain: Destination chain domain ID
 * - amount: Amount in smallest unit (e.g., 1000000 for 1 USDC)
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const sourceDomain = url.searchParams.get('sourceDomain');
		const destDomain = url.searchParams.get('destDomain');
		const amount = url.searchParams.get('amount');
		const fast = url.searchParams.get('fast') !== 'false'; // Default to true

		if (!sourceDomain || !destDomain || !amount) {
			return json(
				{ error: 'Missing required parameters: sourceDomain, destDomain, amount' },
				{ status: 400 }
			);
		}

		const quote = await cctpService.getQuote(
			parseInt(sourceDomain),
			parseInt(destDomain),
			amount,
			fast
		);

		return json({
			sourceDomain: parseInt(sourceDomain),
			destDomain: parseInt(destDomain),
			inputAmount: amount,
			outputAmount: (BigInt(amount) - BigInt(quote.fee)).toString(),
			fee: quote.fee,
			estimatedTime: quote.estimatedTime,
			rate: quote.rate
		});
	} catch (error) {
		console.error('Error getting bridge quote:', error);
		const message = error instanceof Error ? error.message : 'Failed to get quote';
		return json({ error: message }, { status: 400 });
	}
};
