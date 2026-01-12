import { writable, get } from 'svelte/store';
import { evmAddress, wagmiConfig } from './evm.js';
import { starknetAddress } from './starknet.js';
import { sourceChain } from './bridge.js';
import { RpcProvider } from 'starknet';

// Balance stores
export const sourceBalance = writable<string | null>(null);
export const balanceLoading = writable(false);

// Starknet RPC
const STARKNET_RPC =
	typeof window !== 'undefined'
		? (import.meta.env.VITE_STARKNET_RPC as string) || 'https://api.cartridge.gg/x/starknet/mainnet'
		: 'https://api.cartridge.gg/x/starknet/mainnet';

// ERC20 ABI for balance check
const ERC20_ABI = [
	{
		name: 'balanceOf',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }]
	}
] as const;

/**
 * Fetch EVM USDC balance
 */
async function fetchEvmBalance(
	address: string,
	usdcAddress: string,
	chainId: number
): Promise<bigint> {
	const config = get(wagmiConfig);
	if (!config) return BigInt(0);

	const { readContract } = await import('@wagmi/core');

	const balance = await readContract(config, {
		address: usdcAddress as `0x${string}`,
		abi: ERC20_ABI,
		functionName: 'balanceOf',
		args: [address as `0x${string}`],
		chainId
	});

	return balance as bigint;
}

/**
 * Fetch Starknet USDC balance using direct callContract
 */
async function fetchStarknetBalance(address: string, usdcAddress: string): Promise<bigint> {
	const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });

	// Call the contract directly - balanceOf takes a single felt as argument
	// Use 'latest' block instead of 'pending' which some RPCs don't support
	const result = await provider.callContract(
		{
			contractAddress: usdcAddress,
			entrypoint: 'balanceOf',
			calldata: [address]
		},
		'latest'
	);

	// Result is an array of felt strings [low, high] for Uint256
	const low = BigInt(result[0] || '0');
	const high = BigInt(result[1] || '0');
	return low + (high << 128n);
}

/**
 * Fetch balance for the current source chain
 */
export async function fetchSourceBalance(): Promise<void> {
	const chain = get(sourceChain);
	if (!chain) {
		sourceBalance.set(null);
		return;
	}

	balanceLoading.set(true);

	try {
		let balance: bigint;

		if (chain.type === 'evm') {
			const address = get(evmAddress);
			if (!address) {
				sourceBalance.set(null);
				return;
			}
			balance = await fetchEvmBalance(address, chain.usdc, parseInt(chain.chainId));
		} else if (chain.type === 'starknet') {
			const address = get(starknetAddress);
			if (!address) {
				sourceBalance.set(null);
				return;
			}
			balance = await fetchStarknetBalance(address, chain.usdc);
		} else {
			sourceBalance.set(null);
			return;
		}

		// Format balance (USDC has 6 decimals)
		sourceBalance.set(formatBalance(balance));
	} catch (error) {
		console.error('Failed to fetch balance:', error);
		sourceBalance.set(null);
	} finally {
		balanceLoading.set(false);
	}
}

/**
 * Format balance from smallest unit to display format
 */
function formatBalance(balance: bigint): string {
	const whole = balance / BigInt(1e6);
	const fraction = balance % BigInt(1e6);

	if (fraction === BigInt(0)) {
		return whole.toString();
	}

	// Pad fraction and remove trailing zeros
	const fractionStr = fraction.toString().padStart(6, '0').replace(/0+$/, '');
	return `${whole}.${fractionStr}`;
}

/**
 * Get raw balance in smallest units for max button
 */
export async function getRawBalance(): Promise<bigint | null> {
	const chain = get(sourceChain);
	if (!chain) return null;

	try {
		if (chain.type === 'evm') {
			const address = get(evmAddress);
			if (!address) return null;
			return await fetchEvmBalance(address, chain.usdc, parseInt(chain.chainId));
		} else if (chain.type === 'starknet') {
			const address = get(starknetAddress);
			if (!address) return null;
			return await fetchStarknetBalance(address, chain.usdc);
		}
	} catch (error) {
		console.error('Failed to get raw balance:', error);
	}

	return null;
}
