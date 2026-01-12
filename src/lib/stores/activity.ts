import { writable, derived, get } from 'svelte/store';
import type { ActivityTransaction, ActivityResponse } from './types.js';
import { evmAddress, evmChainId, wagmiConfig } from './evm.js';
import { starknetAddress } from './starknet.js';
import { chains } from './bridge.js';

// EVM domain IDs (non-Starknet destinations require manual claim)
const EVM_DOMAIN_IDS = [0, 2, 3, 6, 7]; // Ethereum, Optimism, Arbitrum, Base, Polygon

/**
 * Sanitize error messages to remove long hex data
 */
function sanitizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error)) {
		return 'An unknown error occurred';
	}

	const message = error.message;

	// Check for user rejection patterns
	if (message.includes('User rejected') || message.includes('User denied')) {
		return 'Transaction rejected by user';
	}

	// Check for common wallet errors
	if (message.includes('insufficient funds')) {
		return 'Insufficient funds for transaction';
	}

	// Remove "Request Arguments:" section and everything after
	const requestArgsIndex = message.indexOf('Request Arguments:');
	if (requestArgsIndex > 0) {
		return message.slice(0, requestArgsIndex).trim();
	}

	// Truncate any long hex strings (more than 20 chars)
	const sanitized = message.replace(
		/0x[a-fA-F0-9]{20,}/g,
		(match) => `${match.slice(0, 10)}...${match.slice(-6)}`
	);

	// Limit overall length
	if (sanitized.length > 200) {
		return sanitized.slice(0, 200) + '...';
	}

	return sanitized;
}

// Activity state
export const transactions = writable<ActivityTransaction[]>([]);
export const activityLoading = writable(false);
export const activityLoadingMore = writable(false);
export const activityError = writable<string | null>(null);
export const activityHasMore = writable(false);
export const activityOffset = writable(0);
export const activityTotal = writable(0);

// Claiming state
export const claimingTxId = writable<string | null>(null);
export const claimError = writable<string | null>(null);

// Derived: Claimable transactions (attested status + EVM destination + has mintTxData)
export const claimableTransactions = derived(transactions, ($transactions) =>
	$transactions.filter(
		(tx) =>
			tx.status === 'attested' && EVM_DOMAIN_IDS.includes(tx.destDomainId) && tx.mintTxData?.evm
	)
);

// Derived: Total claimable amount
export const claimableTotalAmount = derived(claimableTransactions, ($claimable) =>
	$claimable.reduce((sum, tx) => sum + BigInt(tx.amount), BigInt(0))
);

/**
 * Get connected wallet addresses
 */
function getConnectedAddresses(): string[] {
	const addresses: string[] = [];
	const evm = get(evmAddress);
	const starknet = get(starknetAddress);

	if (evm) addresses.push(evm);
	if (starknet) addresses.push(starknet);

	return addresses;
}

/**
 * Fetch activity for connected wallets
 */
export async function fetchActivity(): Promise<void> {
	const addresses = getConnectedAddresses();
	if (addresses.length === 0) {
		transactions.set([]);
		activityTotal.set(0);
		activityHasMore.set(false);
		return;
	}

	activityLoading.set(true);
	activityError.set(null);
	activityOffset.set(0);

	try {
		const response = await fetch(
			`/api/bridge/activity?addresses=${addresses.join(',')}&limit=10&offset=0`
		);

		if (!response.ok) {
			throw new Error('Failed to fetch activity');
		}

		const data: ActivityResponse = await response.json();
		transactions.set(data.transactions);
		activityTotal.set(data.total);
		activityHasMore.set(data.hasMore);
		activityOffset.set(data.transactions.length);
	} catch (error) {
		console.error('Failed to fetch activity:', error);
		activityError.set(error instanceof Error ? error.message : 'Failed to fetch activity');
	} finally {
		activityLoading.set(false);
	}
}

/**
 * Load more transactions (pagination)
 */
export async function loadMoreActivity(): Promise<void> {
	const addresses = getConnectedAddresses();
	if (addresses.length === 0 || !get(activityHasMore)) return;

	activityLoadingMore.set(true);

	try {
		const offset = get(activityOffset);
		const response = await fetch(
			`/api/bridge/activity?addresses=${addresses.join(',')}&limit=10&offset=${offset}`
		);

		if (!response.ok) {
			throw new Error('Failed to load more');
		}

		const data: ActivityResponse = await response.json();

		// Append to existing transactions
		transactions.update((existing) => [...existing, ...data.transactions]);
		activityHasMore.set(data.hasMore);
		activityOffset.update((o) => o + data.transactions.length);
	} catch (error) {
		console.error('Failed to load more activity:', error);
	} finally {
		activityLoadingMore.set(false);
	}
}

/**
 * Refresh activity (re-fetch from beginning)
 */
export async function refreshActivity(): Promise<void> {
	await fetchActivity();
}

/**
 * Get chain name by domain ID
 */
export function getChainName(domainId: number): string {
	const chainList = get(chains);
	const chain = chainList.find((c) => c.domainId === domainId);
	return chain?.name || `Chain ${domainId}`;
}

/**
 * Get chain explorer URL by domain ID
 */
export function getExplorerUrl(domainId: number): string | undefined {
	const chainList = get(chains);
	const chain = chainList.find((c) => c.domainId === domainId);
	return chain?.explorerUrl;
}

/**
 * Get transaction URL for a chain
 */
export function getTxUrl(domainId: number, txHash: string): string | undefined {
	const explorerUrl = getExplorerUrl(domainId);
	if (!explorerUrl || !txHash) return undefined;

	// Starknet uses different path
	if (domainId === 25) {
		return `${explorerUrl}/tx/${txHash}`;
	}
	// EVM chains
	return `${explorerUrl}/tx/${txHash}`;
}

/**
 * Claim USDC for an attested transaction
 */
export async function claimTransaction(tx: ActivityTransaction): Promise<boolean> {
	if (!tx.mintTxData?.evm) {
		claimError.set('No mint transaction data available');
		return false;
	}

	const config = get(wagmiConfig);
	if (!config) {
		claimError.set('Wallet not connected');
		return false;
	}

	claimingTxId.set(tx.id);
	claimError.set(null);

	try {
		const { sendTransaction, waitForTransactionReceipt, switchChain, getChainId } = await import(
			'@wagmi/core'
		);

		// Check if we need to switch chains
		const currentChainId = await getChainId(config);
		const targetChainId = tx.mintTxData.evm.chainId;

		if (currentChainId !== targetChainId) {
			try {
				await switchChain(config, { chainId: targetChainId });
			} catch (error) {
				const msg = error instanceof Error ? error.message : 'Unknown error';
				claimError.set(`Please switch to the correct chain: ${msg}`);
				return false;
			}
		}

		// Send the transaction
		const txHash = await sendTransaction(config, {
			to: tx.mintTxData.evm.to as `0x${string}`,
			data: tx.mintTxData.evm.data as `0x${string}`,
			chainId: targetChainId
		});

		// Wait for confirmation
		await waitForTransactionReceipt(config, {
			hash: txHash,
			confirmations: 1
		});

		// Report completion to backend
		const completeResponse = await fetch(`/api/bridge/${tx.id}/complete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ txHash })
		});

		if (!completeResponse.ok) {
			console.warn('Failed to report completion to backend');
		}

		// Refresh activity to show updated status
		await refreshActivity();

		return true;
	} catch (error) {
		console.error('Failed to claim:', error);
		claimError.set(sanitizeErrorMessage(error));
		return false;
	} finally {
		claimingTxId.set(null);
	}
}

/**
 * Format amount from smallest unit to display format
 */
export function formatAmount(amount: string): string {
	const amountBigInt = BigInt(amount);
	const whole = amountBigInt / BigInt(1e6);
	const fraction = amountBigInt % BigInt(1e6);

	if (fraction === BigInt(0)) {
		return whole.toString();
	}

	// Pad fraction to 6 digits and remove trailing zeros
	const fractionStr = fraction.toString().padStart(6, '0').replace(/0+$/, '');
	return `${whole}.${fractionStr}`;
}

/**
 * Format timestamp to relative time
 */
export function formatRelativeTime(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffSec < 60) return 'Just now';
	if (diffMin < 60) return `${diffMin} min ago`;
	if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
	if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;

	return date.toLocaleDateString();
}

/**
 * Get status color class
 */
export function getStatusColor(status: string): string {
	switch (status) {
		case 'completed':
			return 'bg-green-500/20 text-green-400';
		case 'attested':
			return 'bg-blue-500/20 text-blue-400';
		case 'burned':
		case 'initiated':
			return 'bg-yellow-500/20 text-yellow-400';
		case 'failed':
			return 'bg-red-500/20 text-red-400';
		default:
			return 'bg-gray-500/20 text-gray-400';
	}
}

/**
 * Get status display text
 */
export function getStatusText(status: string): string {
	switch (status) {
		case 'completed':
			return 'Completed';
		case 'attested':
			return 'Ready to Claim';
		case 'burned':
			return 'Attesting...';
		case 'initiated':
			return 'Pending';
		case 'minting':
			return 'Minting...';
		case 'failed':
			return 'Failed';
		default:
			return status;
	}
}

/**
 * Truncate address/hash for display
 */
export function truncateHash(hash: string, start = 6, end = 4): string {
	if (!hash) return '';
	if (hash.length <= start + end) return hash;
	return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}
