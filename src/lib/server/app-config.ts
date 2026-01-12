import { env } from '$env/dynamic/private';
import { db } from './db.js';

export type ChainType = 'evm' | 'solana' | 'starknet';

export interface ChainConfig {
	chainId: string;
	domainId: number;
	name: string;
	type: ChainType;
	tokenMessenger: string;
	messageTransmitter: string;
	usdc: string;
	rpcUrl?: string;
	explorerUrl?: string;
	isEnabled: boolean;
	isTestnet: boolean;
}

// In-memory cache for the chain configuration
let chainConfigCache: Map<number, ChainConfig> = new Map();

/**
 * Load chain configuration from the database into the in-memory cache.
 * This should be called on application startup.
 */
export async function loadChainConfig(): Promise<void> {
	console.log('Loading chain configuration from database...');
	const isTestnet = env.CCTP_TESTNET === 'true';

	const rows = await db.execute<ChainConfig>(
		`SELECT
            chain_id as "chainId",
            domain_id as "domainId",
            name,
            chain_type as "type",
            token_messenger as "tokenMessenger",
            message_transmitter as "messageTransmitter",
            usdc_address as "usdc",
            rpc_url as "rpcUrl",
            explorer_url as "explorerUrl",
            is_enabled as "isEnabled",
            is_testnet as "isTestnet"
        FROM supported_chains
        WHERE is_enabled = true AND is_testnet = $1`,
		[isTestnet]
	);

	const newCache = new Map<number, ChainConfig>();
	for (const row of rows) {
		newCache.set(row.domainId, row);
	}

	chainConfigCache = newCache;
	console.log(`Loaded ${chainConfigCache.size} chains for ${isTestnet ? 'testnet' : 'mainnet'}.`);
}

/**
 * Get the configuration for a specific chain by its domain ID.
 * @param domainId The CCTP domain ID of the chain.
 * @returns The chain configuration or undefined if not found.
 */
export function getChainConfig(domainId: number): ChainConfig | undefined {
	return chainConfigCache.get(domainId);
}

/**
 * Get the configurations for all loaded chains.
 * @returns An array of all loaded chain configurations.
 */
export function getAllChainConfigs(): ChainConfig[] {
	return Array.from(chainConfigCache.values());
}
