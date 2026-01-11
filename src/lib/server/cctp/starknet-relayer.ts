import { Account, RpcProvider, type Call } from 'starknet';
import { env } from '$env/dynamic/private';
import { STARKNET_DOMAIN_ID } from './config.js';
import { getChainConfig } from '../app-config.js';

// Cached provider and account
let provider: RpcProvider | null = null;
let account: Account | null = null;

/**
 * Check if Starknet relayer is configured and enabled
 */
export function isStarknetRelayerEnabled(): boolean {
	const enabled = !!(
		env.RELAYER_ENABLED === 'true' &&
		env.STARKNET_RELAYER_ADDRESS &&
		env.STARKNET_RELAYER_PRIVATE_KEY &&
		env.STARKNET_RPC_URL
	);

	if (!enabled) {
		console.log('[StarknetRelayer] Config check:', {
			RELAYER_ENABLED: env.RELAYER_ENABLED,
			hasAddress: !!env.STARKNET_RELAYER_ADDRESS,
			hasPrivateKey: !!env.STARKNET_RELAYER_PRIVATE_KEY,
			hasRpcUrl: !!env.STARKNET_RPC_URL
		});
	}

	return enabled;
}

/**
 * Get or create the Starknet RPC provider
 */
export function getStarknetProvider(): RpcProvider {
	if (provider) return provider;

	if (!env.STARKNET_RPC_URL) {
		throw new Error('STARKNET_RPC_URL not configured');
	}

	provider = new RpcProvider({ nodeUrl: env.STARKNET_RPC_URL });
	return provider;
}

/**
 * Get or create the Starknet relayer account
 */
export function getStarknetRelayerAccount(): Account {
	if (account) return account;

	if (!env.STARKNET_RELAYER_ADDRESS || !env.STARKNET_RELAYER_PRIVATE_KEY) {
		throw new Error('STARKNET_RELAYER_ADDRESS or STARKNET_RELAYER_PRIVATE_KEY not configured');
	}

	const rpcProvider = getStarknetProvider();
	account = new Account(
		rpcProvider,
		env.STARKNET_RELAYER_ADDRESS,
		env.STARKNET_RELAYER_PRIVATE_KEY
	);
	return account;
}

/**
 * Execute a mint transaction on Starknet
 */
export async function executeStarknetMint(
	calls: Call[]
): Promise<{ txHash: string; success: boolean }> {
	const relayerAccount = getStarknetRelayerAccount();

	console.log(`[StarknetRelayer] Executing mint with ${calls.length} call(s)`);

	try {
		// Estimate fee first
		const estimation = await relayerAccount.estimateInvokeFee(calls);

		// Add 30% buffer for safety (Starknet fees can vary)
		const maxFee = (estimation.overall_fee * 130n) / 100n;

		console.log(`[StarknetRelayer] Estimated fee: ${estimation.overall_fee}, using max: ${maxFee}`);

		// Execute the transaction
		const { transaction_hash } = await relayerAccount.execute(calls, { maxFee });

		console.log(`[StarknetRelayer] Transaction submitted: ${transaction_hash}`);

		// Wait for transaction receipt
		const receipt = await relayerAccount.waitForTransaction(transaction_hash, {
			retryInterval: 5000, // Check every 5 seconds
			successStates: ['ACCEPTED_ON_L2', 'ACCEPTED_ON_L1']
		});

		// Check execution status (type narrowing for non-rejected receipts)
		const executionStatus = 'execution_status' in receipt ? receipt.execution_status : undefined;

		if (executionStatus === 'SUCCEEDED') {
			console.log(`[StarknetRelayer] Mint confirmed: ${transaction_hash}`);
			return { txHash: transaction_hash, success: true };
		} else {
			console.error(
				`[StarknetRelayer] Mint reverted: ${transaction_hash}, status: ${executionStatus}`
			);
			return { txHash: transaction_hash, success: false };
		}
	} catch (error) {
		console.error(`[StarknetRelayer] Error executing mint:`, error);
		throw error;
	}
}

/**
 * Get relayer address for balance monitoring
 */
export function getStarknetRelayerAddress(): string | null {
	return env.STARKNET_RELAYER_ADDRESS || null;
}

/**
 * Check relayer ETH balance on Starknet
 */
export async function getStarknetRelayerBalance(): Promise<bigint> {
	const relayerAccount = getStarknetRelayerAccount();
	// ETH contract address on Starknet mainnet
	const ETH_ADDRESS = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';

	const starknetProvider = getStarknetProvider();
	const balance = await starknetProvider.callContract({
		contractAddress: ETH_ADDRESS,
		entrypoint: 'balanceOf',
		calldata: [relayerAccount.address]
	});

	// Balance is returned as u256 (low, high)
	return BigInt(balance[0]);
}

/**
 * Find an existing mint transaction on Starknet by searching for events
 * Used for recovery when a mint succeeded but the DB update failed
 */
export async function findExistingStarknetMintTx(
	sourceDomain: number,
	nonce: bigint
): Promise<string | null> {
	const starknetProvider = getStarknetProvider();
	const config = getChainConfig(STARKNET_DOMAIN_ID);

	if (!config) {
		throw new Error('Starknet config not found');
	}

	try {
		// Get the current block number for the search range
		const currentBlock = await starknetProvider.getBlockNumber();
		// Search last 1000 blocks (Starknet blocks are faster than EVM)
		const fromBlock = currentBlock > 1000 ? currentBlock - 1000 : 0;

		// Query for events from MessageTransmitter
		// Note: The exact event structure depends on Circle's Starknet CCTP contract
		const events = await starknetProvider.getEvents({
			address: config.messageTransmitter,
			from_block: { block_number: fromBlock },
			to_block: { block_number: currentBlock },
			chunk_size: 100
		});

		// Filter by sourceDomain and nonce in event data
		// The actual parsing depends on the Starknet CCTP contract event structure
		for (const event of events.events) {
			// Check if this is a MessageReceived event with matching sourceDomain and nonce
			// Event data format depends on the contract - this is a best-effort check
			if (event.data && event.data.length >= 2) {
				try {
					const eventSourceDomain = parseInt(event.data[0], 16);
					const eventNonce = BigInt(event.data[1]);

					if (eventSourceDomain === sourceDomain && eventNonce === nonce) {
						console.log(
							`[StarknetRelayer] Found existing mint tx: ${event.transaction_hash} for nonce ${nonce}`
						);
						return event.transaction_hash;
					}
				} catch {
					// Event doesn't match expected format, continue
				}
			}
		}

		console.log(
			`[StarknetRelayer] No existing mint tx found for nonce ${nonce} from domain ${sourceDomain}`
		);
		return null;
	} catch (error) {
		console.error(`[StarknetRelayer] Error searching for existing mint tx:`, error);
		return null;
	}
}
