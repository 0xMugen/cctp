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
	attestation?: string; // V2 API includes attestation directly
}

/**
 * Fetch attestation from Circle's Iris API
 * Returns null if attestation is not yet available
 */
export async function fetchAttestation(messageHash: string): Promise<string | null> {
	const apiHost = getIrisApiHost();
	const url = `${apiHost}/v1/attestations/${messageHash}`;

	console.log(`[CCTP] Fetching attestation from: ${url}`);

	try {
		const response = await fetch(url);

		console.log(`[CCTP] Attestation API response status: ${response.status}`);

		if (response.status === 404) {
			console.log(`[CCTP] Attestation not ready yet for hash ${messageHash}`);
			return null;
		}

		if (!response.ok) {
			throw new Error(`Attestation API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as AttestationResponse;
		console.log(`[CCTP] Attestation status: ${data.status}`);

		if (data.status === 'pending') {
			return null;
		}

		return data.attestation || null;
	} catch (error) {
		console.error('[CCTP] Error fetching attestation:', error);
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

export interface MessageResponseV2 {
	messages: Array<{
		message: string;
		attestation: string;
		eventNonce: string;
		cctpVersion: number;
		status: string;
	}>;
}

/**
 * Get message details from transaction hash using V2 API
 */
export async function getMessageFromTx(
	sourceDomainId: number,
	txHash: string
): Promise<MessageResponse | null> {
	const apiHost = getIrisApiHost();
	// V2 API uses query parameter for transaction hash
	const url = `${apiHost}/v2/messages/${sourceDomainId}?transactionHash=${txHash}`;

	console.log(`[CCTP] Fetching message from: ${url}`);

	try {
		const response = await fetch(url);

		console.log(`[CCTP] Message API response status: ${response.status}`);

		if (response.status === 404) {
			console.log(`[CCTP] Message not found yet for tx ${txHash}`);
			return null;
		}

		if (!response.ok) {
			const text = await response.text();
			console.error(`[CCTP] Message API error response: ${text}`);
			throw new Error(`Message API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as MessageResponseV2;
		console.log(`[CCTP] Got message data:`, JSON.stringify(data).slice(0, 500));

		// V2 returns an array of messages, get the first one
		if (data.messages && data.messages.length > 0) {
			const msg = data.messages[0];
			// Only return attestation if it's actual hex data (not "PENDING" string)
			const hasValidAttestation = msg.attestation &&
				msg.attestation !== 'PENDING' &&
				msg.attestation.startsWith('0x');
			return {
				message: msg.message,
				eventNonce: msg.eventNonce,
				status: msg.status,
				attestation: hasValidAttestation ? msg.attestation : undefined
			};
		}

		console.log(`[CCTP] No messages found in response`);
		return null;
	} catch (error) {
		console.error('[CCTP] Error fetching message:', error);
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
 * Get fee estimate for a transfer
 * CCTP transfers are fee-free at the protocol level
 * Gas fees are paid separately by the user
 */
export async function getTransferFees(): Promise<{
	minimumFee: number;
	currency: string;
}> {
	// CCTP protocol doesn't charge fees for transfers
	// Users only pay gas fees on source and destination chains
	return { minimumFee: 0, currency: 'USDC' };
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
