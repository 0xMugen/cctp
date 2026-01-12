import { type Call, cairo, type Uint256 } from 'starknet';
import { getChainConfig } from '../app-config.js';
import { STARKNET_DOMAIN_ID } from './config.js';

// Starknet CCTP contract function selectors
// Based on Circle's official Starknet CCTP documentation
export const CCTP_SELECTORS = {
	DEPOSIT_FOR_BURN: 'deposit_for_burn',
	DEPOSIT_FOR_BURN_WITH_HOOK: 'deposit_for_burn_with_hook',
	HANDLE_RECEIVE_FINALIZED_MESSAGE: 'handle_receive_finalized_message',
	HANDLE_RECEIVE_UNFINALIZED_MESSAGE: 'handle_receive_unfinalized_message',
	APPROVE: 'approve'
} as const;

export interface StarknetDepositForBurnParams {
	amount: bigint;
	destinationDomain: number;
	mintRecipient: string; // Address on destination chain (EVM or Solana)
	maxFee?: bigint; // Maximum fee in USDC (defaults to 0 for standard transfers)
	minFinalityThreshold?: number; // 1000 for fast transfer, 2000+ for standard (defaults to 1000)
}

export interface StarknetReceiveMessageParams {
	message: string; // Hex encoded message bytes
	attestation: string; // Hex encoded attestation
}

/**
 * Convert a bigint to Starknet's Uint256 format
 */
export function toUint256(value: bigint): Uint256 {
	return cairo.uint256(value);
}

/**
 * Convert an EVM address to u256 for Starknet calldata
 * EVM addresses are 20 bytes (160 bits), which exceeds u128 (128 bits)
 * Must properly split into low (128 bits) and high (32 bits)
 * Returns [low, high] as strings for calldata
 */
export function evmAddressToU256(address: string): [string, string] {
	// Remove 0x prefix and parse as BigInt
	const cleanAddress = address.toLowerCase().replace('0x', '');
	const addressBigInt = BigInt(`0x${cleanAddress}`);
	// u256 is (low: u128, high: u128) - must properly split 160-bit EVM address
	const u256 = cairo.uint256(addressBigInt);
	return [u256.low.toString(), u256.high.toString()];
}

/**
 * Convert a Solana address (base58) to u256 for Starknet calldata
 * Solana addresses are 32 bytes (256 bits), need both low and high
 * Returns [low, high] as strings for calldata
 */
export function solanaAddressToU256(address: string): [string, string] {
	// Solana addresses are 32 bytes when decoded from base58
	// For now, we'll assume the address is already in hex format
	// In production, you'd need to decode from base58
	const cleanHex = address.replace('0x', '').padStart(64, '0');
	const high = BigInt(`0x${cleanHex.slice(0, 32)}`);
	const low = BigInt(`0x${cleanHex.slice(32)}`);
	return [low.toString(), high.toString()];
}

/**
 * Build the deposit_for_burn call for Starknet
 * Burns USDC on Starknet to mint on destination chain
 *
 * Function signature from Circle's starknet-cctp:
 * fn deposit_for_burn(
 *     amount: u256,
 *     destination_domain: u32,
 *     mint_recipient: u256,
 *     burn_token: ContractAddress,
 *     destination_caller: u256,  // 0 = any caller allowed
 *     max_fee: u256,
 *     min_finality_threshold: u32,  // 1000 = fast, 2000+ = standard
 * )
 */
export function buildStarknetBurnCall(params: StarknetDepositForBurnParams): Call {
	const starknetConfig = getChainConfig(STARKNET_DOMAIN_ID);
	if (!starknetConfig) {
		throw new Error('Starknet chain config not found');
	}

	const destConfig = getChainConfig(params.destinationDomain);
	if (!destConfig) {
		throw new Error(`Unknown destination domain: ${params.destinationDomain}`);
	}

	// Convert amount to Uint256
	const amountU256 = toUint256(params.amount);

	// Convert recipient address to u256 based on destination chain type
	let mintRecipientU256: [string, string];
	if (destConfig.type === 'evm') {
		mintRecipientU256 = evmAddressToU256(params.mintRecipient);
	} else if (destConfig.type === 'solana') {
		mintRecipientU256 = solanaAddressToU256(params.mintRecipient);
	} else {
		throw new Error(`Cannot bridge from Starknet to ${destConfig.type}`);
	}

	const destinationCallerU256: [string, string] = ['0', '0'];

	const maxFee = params.maxFee ?? BigInt(0);
	const maxFeeU256 = toUint256(maxFee);

	const minFinalityThreshold = params.minFinalityThreshold ?? 1000;

	return {
		contractAddress: starknetConfig.tokenMessenger,
		entrypoint: CCTP_SELECTORS.DEPOSIT_FOR_BURN,
		calldata: [
			amountU256.low.toString(),
			amountU256.high.toString(),
			params.destinationDomain.toString(),
			mintRecipientU256[0],
			mintRecipientU256[1],
			starknetConfig.usdc,
			destinationCallerU256[0],
			destinationCallerU256[1],
			maxFeeU256.low.toString(),
			maxFeeU256.high.toString(),
			minFinalityThreshold.toString()
		]
	};
}

/**
 * Build the ERC20 approve call for Starknet USDC
 */
export function buildStarknetApproveCall(spender: string, amount: bigint): Call {
	const starknetConfig = getChainConfig(STARKNET_DOMAIN_ID);
	if (!starknetConfig) {
		throw new Error('Starknet chain config not found');
	}

	const amountU256 = toUint256(amount);

	return {
		contractAddress: starknetConfig.usdc,
		entrypoint: CCTP_SELECTORS.APPROVE,
		calldata: [spender, amountU256.low.toString(), amountU256.high.toString()]
	};
}

/**
 * Build the handle_receive_finalized_message call for minting on Starknet
 * Called when USDC is burned on source chain (EVM/Solana) and needs to be minted on Starknet
 * Uses the finalized message handler for fully attested messages
 */
export function buildStarknetMintCall(params: StarknetReceiveMessageParams): Call {
	const starknetConfig = getChainConfig(STARKNET_DOMAIN_ID);
	if (!starknetConfig) {
		throw new Error('Starknet chain config not found');
	}

	// Message and attestation need to be converted to calldata format
	// This depends on the actual Starknet CCTP contract implementation
	const messageBytes = hexToFeltArray(params.message);
	const attestationBytes = hexToFeltArray(params.attestation);

	return {
		contractAddress: starknetConfig.messageTransmitter,
		entrypoint: CCTP_SELECTORS.HANDLE_RECEIVE_FINALIZED_MESSAGE,
		calldata: [
			messageBytes.length.toString(),
			...messageBytes,
			attestationBytes.length.toString(),
			...attestationBytes
		]
	};
}

/**
 * Convert hex string to array of felts (for Starknet calldata)
 * Each felt can hold up to 31 bytes
 */
export function hexToFeltArray(hex: string): string[] {
	// Remove 0x prefix
	const cleanHex = hex.replace('0x', '');

	// Split into 62-character chunks (31 bytes each)
	const chunks: string[] = [];
	for (let i = 0; i < cleanHex.length; i += 62) {
		const chunk = cleanHex.slice(i, i + 62);
		chunks.push(`0x${chunk}`);
	}

	return chunks;
}

/**
 * Parse MessageSent event from Starknet transaction receipt
 * Note: This is a placeholder - actual implementation depends on Starknet CCTP contract events
 */
export function parseStarknetMessageEvent(events: Array<{ keys: string[]; data: string[] }>): {
	message: string;
	nonce: bigint;
} | null {
	// Look for the MessageSent event
	// Event structure depends on actual Starknet CCTP contract
	for (const event of events) {
		// Check if this is a MessageSent event
		// The event key would be the selector of the event
		// This is a placeholder - needs actual event structure
		if (event.keys.length > 0) {
			try {
				// Extract message and nonce from event data
				// Actual parsing depends on contract event structure
				const nonce = BigInt(event.data[0] || '0');
				const message = event.data.slice(1).join('');

				return {
					message: `0x${message}`,
					nonce
				};
			} catch {
				// Not the event we're looking for
			}
		}
	}

	return null;
}

/**
 * Build multi-call for approve + depositForBurn in a single transaction
 */
export function buildStarknetBurnMulticall(params: StarknetDepositForBurnParams): Call[] {
	const starknetConfig = getChainConfig(STARKNET_DOMAIN_ID);
	if (!starknetConfig) {
		throw new Error('Starknet chain config not found');
	}

	const approveCall = buildStarknetApproveCall(starknetConfig.tokenMessenger, params.amount);
	const burnCall = buildStarknetBurnCall(params);

	return [approveCall, burnCall];
}
