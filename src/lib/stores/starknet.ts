import { writable, derived, get } from 'svelte/store';
import { RpcProvider, WalletAccount } from 'starknet';

// Starknet RPC endpoint
const STARKNET_RPC =
	typeof window !== 'undefined'
		? (import.meta.env.VITE_STARKNET_RPC as string) || 'https://api.cartridge.gg/x/starknet/mainnet'
		: 'https://api.cartridge.gg/x/starknet/mainnet';

// Types for get-starknet
interface StarknetWallet {
	id: string;
	name: string;
	icon: string;
	request: (params: { type: string }) => Promise<string[]>;
	on?: (event: string, handler: (accounts: string[]) => void) => void;
	off?: (event: string, handler: (accounts: string[]) => void) => void;
}

// Wallet state stores
export const starknetWallet = writable<StarknetWallet | null>(null);
export const starknetAddress = writable<string | null>(null);
export const starknetConnected = writable(false);
export const starknetAccount = writable<WalletAccount | null>(null);
export const starknetConnecting = writable(false);
export const starknetError = writable<string | null>(null);

// Derived store for combined state
export const starknetState = derived(
	[starknetConnected, starknetAddress, starknetConnecting, starknetError],
	([$connected, $address, $connecting, $error]) => ({
		isConnected: $connected,
		address: $address,
		isConnecting: $connecting,
		error: $error
	})
);

const LAST_WALLET_KEY = 'starknet_last_wallet';

/**
 * Setup wallet after connection (shared logic)
 */
async function setupWallet(wallet: StarknetWallet, saveToStorage = true): Promise<boolean> {
	try {
		const accounts = await wallet.request({ type: 'wallet_requestAccounts' });
		const address = accounts[0];

		if (address) {
			starknetWallet.set(wallet);
			starknetAddress.set(address);
			starknetConnected.set(true);

			if (saveToStorage && wallet.id) {
				localStorage.setItem(LAST_WALLET_KEY, wallet.id);
			}

			const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
			const walletAccount = new WalletAccount(provider, wallet);
			starknetAccount.set(walletAccount);

			wallet.on?.('accountsChanged', (newAccounts: string[]) => {
				if (!newAccounts || newAccounts.length === 0) {
					disconnectStarknet();
				} else {
					starknetAddress.set(newAccounts[0]);
				}
			});

			return true;
		}
	} catch (error) {
		console.error('Failed to setup wallet:', error);
	}
	return false;
}

/**
 * Initialize Starknet - attempt to restore previous wallet connection
 */
export async function initStarknet(): Promise<void> {
	if (typeof window === 'undefined') return;

	const lastWalletId = localStorage.getItem(LAST_WALLET_KEY);
	if (!lastWalletId) return;

	try {
		const { connect } = await import('@starknet-io/get-starknet');

		const wallet = await connect({
			modalMode: 'neverAsk',
			modalTheme: 'dark',
			include: [lastWalletId]
		});

		if (wallet) {
			await setupWallet(wallet as unknown as StarknetWallet, false);
		}
	} catch (error) {
		console.debug('No previous Starknet wallet to restore:', error);
		localStorage.removeItem(LAST_WALLET_KEY);
	}
}

/**
 * Connect to a Starknet wallet (ArgentX, Braavos, etc.)
 */
export async function connectStarknet(): Promise<void> {
	if (typeof window === 'undefined') return;

	starknetConnecting.set(true);
	starknetError.set(null);

	try {
		// Dynamic import to avoid SSR issues
		const { connect } = await import('@starknet-io/get-starknet');

		const wallet = await connect({
			modalMode: 'alwaysAsk',
			modalTheme: 'dark'
		});

		if (wallet) {
			await setupWallet(wallet as unknown as StarknetWallet);
		}
	} catch (error) {
		console.error('Failed to connect Starknet wallet:', error);
		starknetError.set(error instanceof Error ? error.message : 'Failed to connect wallet');
	} finally {
		starknetConnecting.set(false);
	}
}

/**
 * Disconnect Starknet wallet
 */
export async function disconnectStarknet(): Promise<void> {
	if (typeof window === 'undefined') return;

	localStorage.removeItem(LAST_WALLET_KEY);

	try {
		const { disconnect } = await import('@starknet-io/get-starknet');
		await disconnect({ clearLastWallet: true });
	} catch {
		// Ignore disconnect errors
	}

	starknetWallet.set(null);
	starknetAddress.set(null);
	starknetConnected.set(false);
	starknetAccount.set(null);
	starknetError.set(null);
}

/**
 * Get the current Starknet account for signing
 */
export function getStarknetAccount(): WalletAccount | null {
	return get(starknetAccount);
}

/**
 * Truncate a Starknet address for display
 */
export function truncateStarknetAddress(address: string): string {
	if (!address) return '';
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
