import { writable, derived, get } from 'svelte/store';
import type { ChainConfig, Quote, BridgeStep, BridgeStatusResponse } from './types.js';

// Bridge configuration (loaded from API)
export const chains = writable<ChainConfig[]>([]);
export const starknetDomainId = writable<number>(25);
export const chainsLoaded = writable(false);

// Bridge form state
export const sourceChain = writable<ChainConfig | null>(null);
export const destChain = writable<ChainConfig | null>(null);
export const bridgeAmount = writable<string>('');

// Active bridge transaction state
export const activeBridgeId = writable<string | null>(null);
export const bridgeStatus = writable<BridgeStatusResponse | null>(null);
export const bridgeStep = writable<BridgeStep>('idle');
export const bridgeError = writable<string | null>(null);

export const isFastTransfer = writable<boolean>(true);

// Quote state
export const currentQuote = writable<Quote | null>(null);
export const quoteFetching = writable(false);

// SSE connection
export const sseConnection = writable<EventSource | null>(null);

// Derived: Check if source is Starknet
export const sourceIsStarknet = derived(
	[sourceChain, starknetDomainId],
	([$source, $starknetId]) => $source?.domainId === $starknetId
);

// Derived: Check if dest is Starknet
export const destIsStarknet = derived(
	[destChain, starknetDomainId],
	([$dest, $starknetId]) => $dest?.domainId === $starknetId
);

// Derived: Available chains for selection
export const availableSourceChains = derived([chains, destChain], ([$chains, $dest]) =>
	$chains.filter((c) => c.domainId !== $dest?.domainId)
);

export const availableDestChains = derived([chains, sourceChain], ([$chains, $source]) =>
	$chains.filter((c) => c.domainId !== $source?.domainId)
);

/**
 * Load chains from the API
 */
export async function loadChains(): Promise<void> {
	try {
		const response = await fetch('/api/bridge/config');
		if (!response.ok) {
			throw new Error('Failed to load bridge config');
		}

		const data = await response.json();
		chains.set(data.chains || []);
		starknetDomainId.set(data.starknetDomainId || 25);
		chainsLoaded.set(true);

		// Default: Set Starknet as dest if available
		const starknet = data.chains?.find(
			(c: ChainConfig) => c.domainId === (data.starknetDomainId || 25)
		);
		if (starknet) {
			destChain.set(starknet);
		}
	} catch (error) {
		console.error('Failed to load chains:', error);
	}
}

/**
 * Fetch a quote for the current bridge parameters
 */
export async function fetchQuote(): Promise<Quote | null> {
	const source = get(sourceChain);
	const dest = get(destChain);
	const amount = get(bridgeAmount);
	const fastTransfer = get(isFastTransfer);

	if (!source || !dest || !amount || parseFloat(amount) <= 0) {
		currentQuote.set(null);
		return null;
	}

	quoteFetching.set(true);

	try {
		// Convert to smallest unit (USDC has 6 decimals)
		const amountInSmallestUnit = Math.floor(parseFloat(amount) * 1e6).toString();

		const response = await fetch(
			`/api/bridge/quote?sourceDomain=${source.domainId}&destDomain=${dest.domainId}&amount=${amountInSmallestUnit}&fast=${fastTransfer}`
		);

		if (!response.ok) {
			throw new Error('Failed to fetch quote');
		}

		const quote = await response.json();
		currentQuote.set(quote);
		return quote;
	} catch (error) {
		console.error('Failed to fetch quote:', error);
		currentQuote.set(null);
		return null;
	} finally {
		quoteFetching.set(false);
	}
}

/**
 * Swap source and destination chains
 */
export function swapChains(): void {
	const source = get(sourceChain);
	const dest = get(destChain);
	sourceChain.set(dest);
	destChain.set(source);
}

/**
 * Set source chain (ensures Starknet constraint)
 */
export function setSourceChain(chain: ChainConfig): void {
	const $starknetId = get(starknetDomainId);
	const $dest = get(destChain);

	sourceChain.set(chain);

	// If neither source nor dest is Starknet, force dest to Starknet
	if (chain.domainId !== $starknetId && $dest?.domainId !== $starknetId) {
		const starknet = get(chains).find((c) => c.domainId === $starknetId);
		if (starknet) {
			destChain.set(starknet);
		}
	}
}

/**
 * Set destination chain (ensures Starknet constraint)
 */
export function setDestChain(chain: ChainConfig): void {
	const $starknetId = get(starknetDomainId);
	const $source = get(sourceChain);

	destChain.set(chain);

	// If neither source nor dest is Starknet, force source to Starknet
	if (chain.domainId !== $starknetId && $source?.domainId !== $starknetId) {
		const starknet = get(chains).find((c) => c.domainId === $starknetId);
		if (starknet) {
			sourceChain.set(starknet);
		}
	}
}

/**
 * Reset bridge state
 */
export function resetBridge(): void {
	activeBridgeId.set(null);
	bridgeStatus.set(null);
	bridgeStep.set('idle');
	bridgeError.set(null);
	bridgeAmount.set('');
	currentQuote.set(null);
	isFastTransfer.set(true);

	// Close SSE connection
	const sse = get(sseConnection);
	if (sse) {
		sse.close();
		sseConnection.set(null);
	}
}

/**
 * Connect to SSE for real-time status updates
 */
export function connectSSE(bridgeId: string): void {
	// Close existing connection
	const existingSse = get(sseConnection);
	if (existingSse) {
		existingSse.close();
	}

	const eventSource = new EventSource(`/api/bridge/${bridgeId}/events`);
	sseConnection.set(eventSource);

	eventSource.onmessage = (event) => {
		try {
			const data = JSON.parse(event.data);

			if (data.type === 'initial' || data.type === 'update') {
				bridgeStatus.set(data);
				updateBridgeStep(data.status, data.attestation_status || data.attestationStatus);
			}

			if (data.type === 'close' || data.status === 'completed' || data.status === 'failed') {
				// Keep connection open for a bit to show final state
				setTimeout(() => {
					eventSource.close();
					sseConnection.set(null);
				}, 2000);
			}
		} catch (error) {
			console.error('Failed to parse SSE message:', error);
		}
	};

	eventSource.onerror = () => {
		console.error('SSE connection error');
		// Reconnect after a delay
		setTimeout(() => {
			const currentBridgeId = get(activeBridgeId);
			if (currentBridgeId === bridgeId) {
				connectSSE(bridgeId);
			}
		}, 5000);
	};
}

/**
 * Update bridge step based on status
 */
function updateBridgeStep(status: string, attestationStatus: string): void {
	switch (status) {
		case 'initiated':
			bridgeStep.set('initiating');
			break;
		case 'burned':
			if (attestationStatus === 'pending') {
				bridgeStep.set('waiting_attestation');
			}
			break;
		case 'attested':
			bridgeStep.set('minting');
			break;
		case 'completed':
			bridgeStep.set('completed');
			break;
		case 'failed':
			bridgeStep.set('failed');
			break;
	}
}

/**
 * Get step label for display
 */
export function getBridgeStepLabel(step: BridgeStep): string {
	switch (step) {
		case 'idle':
			return 'Bridge USDC';
		case 'fetching_quote':
			return 'Fetching quote...';
		case 'approving':
			return 'Approving USDC...';
		case 'initiating':
			return 'Initiating bridge...';
		case 'burning':
			return 'Confirm burn transaction...';
		case 'waiting_attestation':
			return 'Waiting for attestation...';
		case 'minting':
			return 'Confirm mint transaction...';
		case 'completed':
			return 'Bridge completed!';
		case 'failed':
			return 'Bridge USDC';
		default:
			return 'Bridge USDC';
	}
}
