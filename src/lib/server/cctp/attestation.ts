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

export interface MessageResponseV2 {
	messages: Array<{
		message: string;
		attestation: string;
		eventNonce: string;
		cctpVersion: number;
		status: string; // 'pending_confirmations' | 'complete' | 'delivered' etc
	}>;
}

/**
 * Check if a message has been delivered (minted) on destination chain
 * Uses Circle's V2 API to check message status
 *
 * For Starknet destinations with subsidized auto-mint:
 * - When status is "complete" and attestation exists, Circle auto-mints
 * - We treat "complete" as delivered for Starknet
 */
export async function checkMessageDelivered(
	sourceDomainId: number,
	txHash: string,
	isStarknetDest: boolean = false
): Promise<{ delivered: boolean; status?: string }> {
	const apiHost = getIrisApiHost();
	const url = `${apiHost}/v2/messages/${sourceDomainId}?transactionHash=${txHash}`;

	try {
		const response = await fetch(url);

		if (!response.ok) {
			return { delivered: false };
		}

		const data = (await response.json()) as MessageResponseV2;

		if (data.messages && data.messages.length > 0) {
			const msg = data.messages[0];
			const status = msg.status.toLowerCase();

			// For Starknet with Circle auto-mint: "complete" means attestation ready AND auto-minted
			// For other chains: check for explicit delivery status
			let isDelivered = false;

			if (isStarknetDest) {
				// Starknet uses Circle subsidized auto-mint
				// When attestation is "complete", Circle has auto-minted
				isDelivered = status === 'complete' && !!msg.attestation && msg.attestation !== 'PENDING';
			} else {
				// Other chains - check for explicit delivery status
				const deliveredStatuses = ['delivered', 'received', 'minted'];
				isDelivered = deliveredStatuses.includes(status);
			}

			console.log(
				`[CCTP] Message status for ${txHash}: ${msg.status}, isStarknetDest: ${isStarknetDest}, delivered: ${isDelivered}`
			);

			return { delivered: isDelivered, status: msg.status };
		}

		return { delivered: false };
	} catch (error) {
		console.error('[CCTP] Error checking message delivery:', error);
		return { delivered: false };
	}
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
			const hasValidAttestation =
				msg.attestation && msg.attestation !== 'PENDING' && msg.attestation.startsWith('0x');
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
