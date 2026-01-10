import {
	type Address,
	type Hex,
	encodeFunctionData,
	decodeEventLog,
	parseAbi,
	pad,
	type TransactionReceipt
} from 'viem';
import { getChainConfig, STARKNET_DOMAIN_ID } from './config.js';

// CCTP Contract ABIs
export const TOKEN_MESSENGER_ABI = parseAbi([
	'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external returns (uint64 nonce)',
	'function depositForBurnWithCaller(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller) external returns (uint64 nonce)',
	'event DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)'
]);

export const MESSAGE_TRANSMITTER_ABI = parseAbi([
	'function receiveMessage(bytes message, bytes attestation) external returns (bool success)',
	'event MessageSent(bytes message)',
	'event MessageReceived(address indexed caller, uint32 sourceDomain, uint64 indexed nonce, bytes32 sender, bytes messageBody)'
]);

export const ERC20_ABI = parseAbi([
	'function approve(address spender, uint256 amount) external returns (bool)',
	'function allowance(address owner, address spender) external view returns (uint256)',
	'function balanceOf(address account) external view returns (uint256)'
]);

export interface DepositForBurnParams {
	amount: bigint;
	destinationDomain: number;
	mintRecipient: string; // Recipient address on destination chain
	burnToken: Address;
}

export interface ParsedMessageSentEvent {
	message: Hex;
	nonce: bigint;
}

/**
 * Convert an address to bytes32 format for CCTP
 * Pads the address to 32 bytes (left-padded with zeros)
 */
export function addressToBytes32(address: string): Hex {
	// Remove 0x prefix if present, then pad to 32 bytes
	const cleanAddress = address.toLowerCase().replace('0x', '');
	return `0x${cleanAddress.padStart(64, '0')}` as Hex;
}

/**
 * Convert Starknet address to bytes32 format
 */
export function starknetAddressToBytes32(address: string): Hex {
	// Starknet addresses are already 32 bytes (252 bits)
	const cleanAddress = address.toLowerCase().replace('0x', '');
	return `0x${cleanAddress.padStart(64, '0')}` as Hex;
}

/**
 * Generate the transaction data for depositForBurn
 */
export function getDepositForBurnTxData(params: DepositForBurnParams): {
	to: Address;
	data: Hex;
	chainId: number;
} {
	// Get the source chain config (we need to know which EVM chain)
	// This assumes we're burning on an EVM chain to send to Starknet
	const destConfig = getChainConfig(params.destinationDomain);
	if (!destConfig) {
		throw new Error(`Unknown destination domain: ${params.destinationDomain}`);
	}

	// Convert recipient address based on destination chain type
	let mintRecipientBytes32: Hex;
	if (destConfig.type === 'starknet') {
		mintRecipientBytes32 = starknetAddressToBytes32(params.mintRecipient);
	} else {
		mintRecipientBytes32 = addressToBytes32(params.mintRecipient);
	}

	const data = encodeFunctionData({
		abi: TOKEN_MESSENGER_ABI,
		functionName: 'depositForBurn',
		args: [params.amount, params.destinationDomain, mintRecipientBytes32, params.burnToken]
	});

	// Get source chain config to get TokenMessenger address
	// We need the caller to specify which chain they're on
	return {
		to: '0x0000000000000000000000000000000000000000' as Address, // Caller must set this
		data,
		chainId: 0 // Caller must set this
	};
}

/**
 * Generate ERC20 approval transaction data
 */
export function getApprovalTxData(
	tokenAddress: Address,
	spenderAddress: Address,
	amount: bigint
): Hex {
	return encodeFunctionData({
		abi: ERC20_ABI,
		functionName: 'approve',
		args: [spenderAddress, amount]
	});
}

/**
 * Parse MessageSent event from transaction receipt
 */
export function parseMessageSentEvent(receipt: TransactionReceipt): ParsedMessageSentEvent | null {
	for (const log of receipt.logs) {
		try {
			const decoded = decodeEventLog({
				abi: MESSAGE_TRANSMITTER_ABI,
				data: log.data,
				topics: log.topics
			});

			if (decoded.eventName === 'MessageSent') {
				const args = decoded.args as { message: Hex };
				// Extract nonce from message (first 8 bytes after header)
				// Message format: version (4) + sourceDomain (4) + destDomain (4) + nonce (8) + ...
				const nonceHex = `0x${args.message.slice(26, 42)}` as Hex;
				const nonce = BigInt(nonceHex);

				return {
					message: args.message,
					nonce
				};
			}
		} catch {
			// Not a MessageSent event, continue
		}
	}

	return null;
}

/**
 * Parse DepositForBurn event from transaction receipt
 */
export function parseDepositForBurnEvent(
	receipt: TransactionReceipt
): {
	nonce: bigint;
	amount: bigint;
	depositor: Address;
	mintRecipient: Hex;
	destinationDomain: number;
} | null {
	for (const log of receipt.logs) {
		try {
			const decoded = decodeEventLog({
				abi: TOKEN_MESSENGER_ABI,
				data: log.data,
				topics: log.topics
			});

			if (decoded.eventName === 'DepositForBurn') {
				const args = decoded.args as {
					nonce: bigint;
					burnToken: Address;
					amount: bigint;
					depositor: Address;
					mintRecipient: Hex;
					destinationDomain: number;
					destinationTokenMessenger: Hex;
					destinationCaller: Hex;
				};

				return {
					nonce: args.nonce,
					amount: args.amount,
					depositor: args.depositor,
					mintRecipient: args.mintRecipient,
					destinationDomain: args.destinationDomain
				};
			}
		} catch {
			// Not a DepositForBurn event, continue
		}
	}

	return null;
}

/**
 * Generate transaction data for receiveMessage (mint)
 */
export function getReceiveMessageTxData(message: Hex, attestation: Hex): Hex {
	return encodeFunctionData({
		abi: MESSAGE_TRANSMITTER_ABI,
		functionName: 'receiveMessage',
		args: [message, attestation]
	});
}

/**
 * Build the complete deposit for burn transaction for a specific EVM chain
 */
export function buildDepositForBurnTx(
	sourceDomainId: number,
	params: DepositForBurnParams
): {
	to: Address;
	data: Hex;
	chainId: number;
} {
	const sourceConfig = getChainConfig(sourceDomainId);
	if (!sourceConfig) {
		throw new Error(`Unknown source domain: ${sourceDomainId}`);
	}

	if (sourceConfig.type !== 'evm') {
		throw new Error(`Source domain ${sourceDomainId} is not an EVM chain`);
	}

	const destConfig = getChainConfig(params.destinationDomain);
	if (!destConfig) {
		throw new Error(`Unknown destination domain: ${params.destinationDomain}`);
	}

	// Convert recipient address based on destination chain type
	let mintRecipientBytes32: Hex;
	if (destConfig.type === 'starknet') {
		mintRecipientBytes32 = starknetAddressToBytes32(params.mintRecipient);
	} else if (destConfig.type === 'solana') {
		// Solana addresses are base58, need special handling
		mintRecipientBytes32 = pad(params.mintRecipient as Hex, { size: 32 });
	} else {
		mintRecipientBytes32 = addressToBytes32(params.mintRecipient);
	}

	const data = encodeFunctionData({
		abi: TOKEN_MESSENGER_ABI,
		functionName: 'depositForBurn',
		args: [params.amount, params.destinationDomain, mintRecipientBytes32, params.burnToken]
	});

	return {
		to: sourceConfig.tokenMessenger as Address,
		data,
		chainId: parseInt(sourceConfig.chainId)
	};
}

/**
 * Build the complete receive message transaction for minting on EVM
 */
export function buildReceiveMessageTx(
	destDomainId: number,
	message: Hex,
	attestation: Hex
): {
	to: Address;
	data: Hex;
	chainId: number;
} {
	const destConfig = getChainConfig(destDomainId);
	if (!destConfig) {
		throw new Error(`Unknown destination domain: ${destDomainId}`);
	}

	if (destConfig.type !== 'evm') {
		throw new Error(`Destination domain ${destDomainId} is not an EVM chain`);
	}

	const data = encodeFunctionData({
		abi: MESSAGE_TRANSMITTER_ABI,
		functionName: 'receiveMessage',
		args: [message, attestation]
	});

	return {
		to: destConfig.messageTransmitter as Address,
		data,
		chainId: parseInt(destConfig.chainId)
	};
}
