import { env } from '$env/dynamic/private';

// Starknet is always one side of every bridge
export const STARKNET_DOMAIN_ID = 25;

// CCTP V2 Domain IDs
export const DOMAIN_IDS = {
	ETHEREUM: 0,
	OPTIMISM: 2,
	ARBITRUM: 3,
	SOLANA: 5,
	BASE: 6,
	POLYGON: 7,
	STARKNET: 25
} as const;

// Circle Iris API endpoints
export const IRIS_API = {
	mainnet: 'https://iris-api.circle.com',
	testnet: 'https://iris-api-sandbox.circle.com'
} as const;

// Get API host based on environment
export function getIrisApiHost(): string {
	const isTestnet = env.CCTP_TESTNET === 'true';
	return isTestnet ? IRIS_API.testnet : IRIS_API.mainnet;
}

// Validate that a bridge involves Starknet
export function isValidBridgePair(sourceDomain: number, destDomain: number): boolean {
	// One side must be Starknet
	return sourceDomain === STARKNET_DOMAIN_ID || destDomain === STARKNET_DOMAIN_ID;
}

// Get the non-Starknet chain in a bridge pair
export function getCounterpartyDomain(sourceDomain: number, destDomain: number): number {
	if (sourceDomain === STARKNET_DOMAIN_ID) return destDomain;
	if (destDomain === STARKNET_DOMAIN_ID) return sourceDomain;
	throw new Error('Invalid bridge pair: must involve Starknet');
}
