import { keccak256 } from 'viem';
import { getIrisApiHost } from './config.js';

export interface AttestationResponse {
	status: 'pending' | 'complete';
	attestation?: string;
}

export interface MessageResponse {
	message: string;
	eventNonce: string;
	status: string;
}

/**
 * Fetch attestation from Circle's Iris API
 * Returns null if attestation is not yet available
 */
export async function fetchAttestation(messageHash: string): Promise<string | null> {
	const apiHost = getIrisApiHost();
	const url = `${apiHost}/v1/attestations/${messageHash}`;

	try {
		const response = await fetch(url);

		if (response.status === 404) {
			// Attestation not ready yet
			return null;
		}

		if (!response.ok) {
			throw new Error(`Attestation API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as AttestationResponse;

		if (data.status === 'pending') {
			return null;
		}

		return data.attestation || null;
	} catch (error) {
		console.error('Error fetching attestation:', error);
		throw error;
	}
}

/**
 * Fetch V2 attestation (for Fast Transfer support)
 */
export async function fetchAttestationV2(messageHash: string): Promise<string | null> {
	const apiHost = getIrisApiHost();
	const url = `${apiHost}/v2/attestations/${messageHash}`;

	try {
		const response = await fetch(url);

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			throw new Error(`Attestation V2 API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as AttestationResponse;

		if (data.status === 'pending') {
			return null;
		}

		return data.attestation || null;
	} catch (error) {
		console.error('Error fetching V2 attestation:', error);
		throw error;
	}
}

/**
 * Get message details from transaction hash
 */
export async function getMessageFromTx(
	sourceDomainId: number,
	txHash: string
): Promise<MessageResponse | null> {
	const apiHost = getIrisApiHost();
	const url = `${apiHost}/v1/messages/${sourceDomainId}/${txHash}`;

	try {
		const response = await fetch(url);

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			throw new Error(`Message API error: ${response.status} ${response.statusText}`);
		}

		return (await response.json()) as MessageResponse;
	} catch (error) {
		console.error('Error fetching message:', error);
		throw error;
	}
}

/**
 * Compute the message hash from message bytes
 * This is used to query the attestation API
 */
export function computeMessageHash(messageBytes: string): string {
	// Ensure the message has 0x prefix
	const normalizedMessage = messageBytes.startsWith('0x') ? messageBytes : `0x${messageBytes}`;
	return keccak256(normalizedMessage as `0x${string}`);
}

/**
 * Get fee estimate for a transfer (V2)
 */
export async function getTransferFees(): Promise<{
	minimumFee: number;
	currency: string;
}> {
	const apiHost = getIrisApiHost();
	const url = `${apiHost}/v2/burn/USDC/fees`;

	try {
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Fee API error: ${response.status} ${response.statusText}`);
		}

		return await response.json();
	} catch (error) {
		console.error('Error fetching fees:', error);
		// Return default fee if API fails
		return { minimumFee: 0, currency: 'USDC' };
	}
}

/**
 * Poll for attestation with exponential backoff
 * Useful for waiting on attestations in a controlled manner
 */
export async function pollForAttestation(
	messageHash: string,
	options: {
		maxAttempts?: number;
		initialDelayMs?: number;
		maxDelayMs?: number;
	} = {}
): Promise<string | null> {
	const { maxAttempts = 60, initialDelayMs = 2000, maxDelayMs = 10000 } = options;

	let delay = initialDelayMs;
	let attempts = 0;

	while (attempts < maxAttempts) {
		const attestation = await fetchAttestation(messageHash);

		if (attestation) {
			return attestation;
		}

		attempts++;
		await new Promise((resolve) => setTimeout(resolve, delay));

		// Exponential backoff with max cap
		delay = Math.min(delay * 1.5, maxDelayMs);
	}

	return null;
}
