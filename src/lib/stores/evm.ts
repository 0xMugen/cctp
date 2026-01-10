import { writable, derived, get } from 'svelte/store';

// EVM wallet state stores
export const evmAddress = writable<string | null>(null);
export const evmChainId = writable<number | null>(null);
export const evmConnected = writable(false);
export const evmConnecting = writable(false);
export const evmError = writable<string | null>(null);

// Wagmi config store (set during initialization)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wagmiConfig = writable<any>(null);

// Derived store for combined state
export const evmState = derived(
	[evmConnected, evmAddress, evmChainId, evmConnecting, evmError],
	([$connected, $address, $chainId, $connecting, $error]) => ({
		isConnected: $connected,
		address: $address,
		chainId: $chainId,
		isConnecting: $connecting,
		error: $error
	})
);

/**
 * Connect to EVM wallet (MetaMask, etc.)
 */
export async function connectEvm(): Promise<void> {
	if (typeof window === 'undefined') return;

	evmConnecting.set(true);
	evmError.set(null);

	try {
		const config = get(wagmiConfig);
		if (!config) {
			throw new Error('Wagmi not initialized. Please wait a moment and try again.');
		}

		const { connect } = await import('@wagmi/core');
		const { injected } = await import('@wagmi/connectors');

		const result = await connect(config, {
			connector: injected()
		});

		if (result.accounts[0]) {
			evmAddress.set(result.accounts[0]);
			evmChainId.set(result.chainId);
			evmConnected.set(true);
		}
	} catch (error) {
		console.error('Failed to connect EVM wallet:', error);
		const message = error instanceof Error ? error.message : 'Failed to connect wallet';
		// Make error more user-friendly
		if (message.includes('Connector not found')) {
			evmError.set('No wallet found. Please install MetaMask.');
		} else {
			evmError.set(message);
		}
	} finally {
		evmConnecting.set(false);
	}
}

/**
 * Disconnect EVM wallet
 */
export async function disconnectEvm(): Promise<void> {
	if (typeof window === 'undefined') return;

	try {
		const config = get(wagmiConfig);
		if (config) {
			const { disconnect } = await import('@wagmi/core');
			await disconnect(config);
		}
	} catch {
		// Ignore disconnect errors
	}

	evmAddress.set(null);
	evmChainId.set(null);
	evmConnected.set(false);
	evmError.set(null);
}

/**
 * Switch to a different chain
 */
export async function switchEvmChain(chainId: number): Promise<void> {
	const config = get(wagmiConfig);
	if (!config) {
		throw new Error('Wagmi not initialized');
	}

	const { switchChain } = await import('@wagmi/core');
	await switchChain(config, { chainId });
	evmChainId.set(chainId);
}

/**
 * Get the current wagmi config
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getWagmiConfig(): any {
	return get(wagmiConfig);
}

/**
 * Truncate an EVM address for display
 */
export function truncateEvmAddress(address: string): string {
	if (!address) return '';
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Sync state from wagmi (called from layout)
 */
export function syncEvmState(
	address: string | undefined,
	chainId: number | undefined,
	isConnected: boolean
): void {
	evmAddress.set(address || null);
	evmChainId.set(chainId || null);
	evmConnected.set(isConnected);
}
