import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cctpService } from '$lib/server/cctp/service.js';
import { STARKNET_DOMAIN_ID } from '$lib/server/cctp/config.js';

/**
 * GET /api/bridge/config
 * Returns supported chains and configuration
 */
export const GET: RequestHandler = async () => {
	try {
		const chains = cctpService.getChains();

		return json({
			chains: chains.map((chain) => ({
				chainId: chain.chainId,
				domainId: chain.domainId,
				name: chain.name,
				type: chain.type,
				usdc: chain.usdc,
				explorerUrl: chain.explorerUrl
			})),
			starknetDomainId: STARKNET_DOMAIN_ID,
			// Indicate that all bridges must involve Starknet
			bridgeRequirement: 'All bridges must have Starknet as either source or destination'
		});
	} catch (error) {
		console.error('Error getting bridge config:', error);
		return json({ error: 'Failed to get bridge configuration' }, { status: 500 });
	}
};
