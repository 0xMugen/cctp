import {
	createWalletClient,
	createPublicClient,
	http,
	type Chain,
	type Hex,
	type Address,
	type Account,
	type Transport
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, optimism, arbitrum, base, polygon } from 'viem/chains';

// Type for our wallet clients with known account and chain
type RelayerWalletClient = ReturnType<typeof createWalletClient<Transport, Chain, PrivateKeyAccount>>;
type RelayerPublicClient = ReturnType<typeof createPublicClient<Transport, Chain>>;
import { env } from '$env/dynamic/private';
import { DOMAIN_IDS, getChainConfig } from './config.js';

// Map domain IDs to viem chains
const DOMAIN_TO_CHAIN: Record<number, Chain> = {
	[DOMAIN_IDS.ETHEREUM]: mainnet,
	[DOMAIN_IDS.OPTIMISM]: optimism,
	[DOMAIN_IDS.ARBITRUM]: arbitrum,
	[DOMAIN_IDS.BASE]: base,
	[DOMAIN_IDS.POLYGON]: polygon
};

// Map domain IDs to RPC URL env var names
const DOMAIN_TO_RPC_ENV: Record<number, string> = {
	[DOMAIN_IDS.ETHEREUM]: 'ETH_RPC_URL',
	[DOMAIN_IDS.OPTIMISM]: 'OPTIMISM_RPC_URL',
	[DOMAIN_IDS.ARBITRUM]: 'ARBITRUM_RPC_URL',
	[DOMAIN_IDS.BASE]: 'BASE_RPC_URL',
	[DOMAIN_IDS.POLYGON]: 'POLYGON_RPC_URL'
};

// Cached clients
const walletClients: Map<number, RelayerWalletClient> = new Map();
const publicClients: Map<number, RelayerPublicClient> = new Map();

/**
 * Check if relayer is enabled and configured
 */
export function isRelayerEnabled(): boolean {
	return env.RELAYER_ENABLED === 'true' && !!env.RELAYER_PRIVATE_KEY;
}

/**
 * Get the relayer account
 */
function getRelayerAccount() {
	if (!env.RELAYER_PRIVATE_KEY) {
		throw new Error('RELAYER_PRIVATE_KEY not configured');
	}
	return privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
}

/**
 * Get RPC URL for a domain
 */
function getRpcUrl(domainId: number): string {
	const envVar = DOMAIN_TO_RPC_ENV[domainId];
	if (!envVar) {
		throw new Error(`No RPC URL mapping for domain ${domainId}`);
	}

	const rpcUrl = env[envVar];
	if (!rpcUrl) {
		// Fall back to chain config RPC if available
		const chainConfig = getChainConfig(domainId);
		if (chainConfig?.rpcUrl) {
			return chainConfig.rpcUrl;
		}
		throw new Error(`${envVar} not configured for domain ${domainId}`);
	}

	return rpcUrl;
}

/**
 * Get or create a wallet client for a domain
 */
export function getWalletClient(domainId: number): RelayerWalletClient {
	if (walletClients.has(domainId)) {
		return walletClients.get(domainId)!;
	}

	const chain = DOMAIN_TO_CHAIN[domainId];
	if (!chain) {
		throw new Error(`Unsupported domain for relayer: ${domainId}`);
	}

	const rpcUrl = getRpcUrl(domainId);
	const account = getRelayerAccount();

	const client = createWalletClient({
		account,
		chain,
		transport: http(rpcUrl)
	});

	walletClients.set(domainId, client);
	return client;
}

/**
 * Get or create a public client for a domain
 */
export function getPublicClient(domainId: number): RelayerPublicClient {
	if (publicClients.has(domainId)) {
		return publicClients.get(domainId)!;
	}

	const chain = DOMAIN_TO_CHAIN[domainId];
	if (!chain) {
		throw new Error(`Unsupported domain for relayer: ${domainId}`);
	}

	const rpcUrl = getRpcUrl(domainId);

	const client = createPublicClient({
		chain,
		transport: http(rpcUrl)
	});

	publicClients.set(domainId, client);
	return client;
}

/**
 * Execute a mint transaction on the destination chain
 */
export async function executeMint(
	domainId: number,
	to: Address,
	data: Hex
): Promise<{ txHash: Hex; success: boolean }> {
	const walletClient = getWalletClient(domainId);
	const publicClient = getPublicClient(domainId);

	console.log(`[Relayer] Executing mint on domain ${domainId} to ${to}`);

	try {
		// Estimate gas first
		const gasEstimate = await publicClient.estimateGas({
			account: walletClient.account!,
			to,
			data
		});

		// Add 20% buffer for safety
		const gasLimit = (gasEstimate * 120n) / 100n;

		// Send transaction - account and chain are already set on the client
		const txHash = await walletClient.sendTransaction({
			to,
			data,
			gas: gasLimit,
			chain: null // Use chain from client
		});

		console.log(`[Relayer] Mint transaction sent: ${txHash}`);

		// Wait for confirmation
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
			confirmations: 1
		});

		if (receipt.status === 'success') {
			console.log(`[Relayer] Mint confirmed in block ${receipt.blockNumber}`);
			return { txHash, success: true };
		} else {
			console.error(`[Relayer] Mint transaction reverted: ${txHash}`);
			return { txHash, success: false };
		}
	} catch (error) {
		console.error(`[Relayer] Error executing mint:`, error);
		throw error;
	}
}

/**
 * Get the relayer address for monitoring balance
 */
export function getRelayerAddress(): Address | null {
	if (!env.RELAYER_PRIVATE_KEY) {
		return null;
	}
	return getRelayerAccount().address;
}

/**
 * Check relayer balance on a chain
 */
export async function getRelayerBalance(domainId: number): Promise<bigint> {
	const publicClient = getPublicClient(domainId);
	const address = getRelayerAddress();

	if (!address) {
		throw new Error('Relayer not configured');
	}

	return publicClient.getBalance({ address });
}
