import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { getChainConfig, DOMAIN_IDS, STARKNET_DOMAIN_ID } from './config.js';

// Solana CCTP Program IDs (mainnet)
export const CCTP_PROGRAM_IDS = {
	TOKEN_MESSENGER: 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3',
	MESSAGE_TRANSMITTER: 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd'
} as const;

// USDC on Solana
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface SolanaDepositForBurnParams {
	amount: bigint;
	destinationDomain: number;
	mintRecipient: string; // Starknet address (hex)
	senderTokenAccount: string; // Sender's USDC token account
	sender: string; // Sender's wallet address
}

export interface SolanaReceiveMessageParams {
	message: Buffer;
	attestation: Buffer;
	recipient: string; // Recipient's wallet address
}

/**
 * Convert a Starknet address (hex) to a 32-byte buffer for CCTP
 */
export function starknetAddressToBuffer(address: string): Buffer {
	// Remove 0x prefix
	const cleanAddress = address.replace('0x', '');
	// Pad to 64 characters (32 bytes)
	const paddedAddress = cleanAddress.padStart(64, '0');
	return Buffer.from(paddedAddress, 'hex');
}

/**
 * Convert an EVM address to a 32-byte buffer for CCTP
 */
export function evmAddressToBuffer(address: string): Buffer {
	// Remove 0x prefix
	const cleanAddress = address.replace('0x', '');
	// Pad to 64 characters (32 bytes)
	const paddedAddress = cleanAddress.padStart(64, '0');
	return Buffer.from(paddedAddress, 'hex');
}

/**
 * Find the PDA for the message transmitter authority
 */
export function findMessageTransmitterAuthority(): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('message_transmitter_authority')],
		new PublicKey(CCTP_PROGRAM_IDS.MESSAGE_TRANSMITTER)
	);
}

/**
 * Find the PDA for the token messenger minter
 */
export function findTokenMessengerMinter(): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('token_messenger_minter')],
		new PublicKey(CCTP_PROGRAM_IDS.TOKEN_MESSENGER)
	);
}

/**
 * Find the PDA for the local token account
 */
export function findLocalToken(mint: PublicKey): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('local_token'), mint.toBuffer()],
		new PublicKey(CCTP_PROGRAM_IDS.TOKEN_MESSENGER)
	);
}

/**
 * Find the PDA for the remote token messenger
 */
export function findRemoteTokenMessenger(remoteDomain: number): [PublicKey, number] {
	const remoteDomainBuffer = Buffer.alloc(4);
	remoteDomainBuffer.writeUInt32LE(remoteDomain);

	return PublicKey.findProgramAddressSync(
		[Buffer.from('remote_token_messenger'), remoteDomainBuffer],
		new PublicKey(CCTP_PROGRAM_IDS.TOKEN_MESSENGER)
	);
}

/**
 * Build the depositForBurn instruction for Solana
 * Burns USDC on Solana to mint on Starknet
 */
export function buildSolanaBurnInstruction(params: SolanaDepositForBurnParams): {
	instruction: TransactionInstruction;
	accounts: Array<{ pubkey: PublicKey; name: string }>;
} {
	const solanaConfig = getChainConfig(DOMAIN_IDS.SOLANA);
	if (!solanaConfig) {
		throw new Error('Solana chain config not found');
	}

	const destConfig = getChainConfig(params.destinationDomain);
	if (!destConfig) {
		throw new Error(`Unknown destination domain: ${params.destinationDomain}`);
	}

	// Convert recipient address based on destination chain type
	let mintRecipientBuffer: Buffer;
	if (destConfig.type === 'starknet') {
		mintRecipientBuffer = starknetAddressToBuffer(params.mintRecipient);
	} else if (destConfig.type === 'evm') {
		mintRecipientBuffer = evmAddressToBuffer(params.mintRecipient);
	} else {
		throw new Error(`Cannot bridge from Solana to ${destConfig.type}`);
	}

	const tokenMessengerProgram = new PublicKey(CCTP_PROGRAM_IDS.TOKEN_MESSENGER);
	const messageTransmitterProgram = new PublicKey(CCTP_PROGRAM_IDS.MESSAGE_TRANSMITTER);
	const usdcMint = new PublicKey(SOLANA_USDC_MINT);
	const sender = new PublicKey(params.sender);
	const senderTokenAccount = new PublicKey(params.senderTokenAccount);

	// Find PDAs
	const [messageTransmitterAuthority] = findMessageTransmitterAuthority();
	const [tokenMessengerMinter] = findTokenMessengerMinter();
	const [localToken] = findLocalToken(usdcMint);
	const [remoteTokenMessenger] = findRemoteTokenMessenger(params.destinationDomain);

	// Build instruction data
	// Format: discriminator (8 bytes) + amount (8 bytes) + destination_domain (4 bytes) + mint_recipient (32 bytes)
	const discriminator = Buffer.from([0x01]); // depositForBurn discriminator (placeholder)
	const amountBuffer = Buffer.alloc(8);
	amountBuffer.writeBigUInt64LE(params.amount);
	const domainBuffer = Buffer.alloc(4);
	domainBuffer.writeUInt32LE(params.destinationDomain);

	const data = Buffer.concat([discriminator, amountBuffer, domainBuffer, mintRecipientBuffer]);

	// Account list (order matters!)
	const accounts = [
		{ pubkey: sender, name: 'sender' },
		{ pubkey: senderTokenAccount, name: 'senderTokenAccount' },
		{ pubkey: usdcMint, name: 'burnTokenMint' },
		{ pubkey: messageTransmitterProgram, name: 'messageTransmitterProgram' },
		{ pubkey: messageTransmitterAuthority, name: 'messageTransmitterAuthority' },
		{ pubkey: tokenMessengerMinter, name: 'tokenMessengerMinter' },
		{ pubkey: localToken, name: 'localToken' },
		{ pubkey: remoteTokenMessenger, name: 'remoteTokenMessenger' },
		{ pubkey: SystemProgram.programId, name: 'systemProgram' }
	];

	const instruction = new TransactionInstruction({
		programId: tokenMessengerProgram,
		keys: accounts.map((acc) => ({
			pubkey: acc.pubkey,
			isSigner: acc.name === 'sender',
			isWritable: ['sender', 'senderTokenAccount', 'burnTokenMint'].includes(acc.name)
		})),
		data
	});

	return { instruction, accounts };
}

/**
 * Build the receiveMessage instruction for minting on Solana
 * Called when USDC is burned on source chain and needs to be minted on Solana
 */
export function buildSolanaMintInstruction(params: SolanaReceiveMessageParams): {
	instruction: TransactionInstruction;
	accounts: Array<{ pubkey: PublicKey; name: string }>;
} {
	const messageTransmitterProgram = new PublicKey(CCTP_PROGRAM_IDS.MESSAGE_TRANSMITTER);
	const tokenMessengerProgram = new PublicKey(CCTP_PROGRAM_IDS.TOKEN_MESSENGER);
	const usdcMint = new PublicKey(SOLANA_USDC_MINT);
	const recipient = new PublicKey(params.recipient);

	// Find PDAs
	const [messageTransmitterAuthority] = findMessageTransmitterAuthority();
	const [tokenMessengerMinter] = findTokenMessengerMinter();
	const [localToken] = findLocalToken(usdcMint);

	// Build instruction data
	// Format: discriminator (8 bytes) + message_length (4 bytes) + message + attestation_length (4 bytes) + attestation
	const discriminator = Buffer.from([0x02]); // receiveMessage discriminator (placeholder)
	const messageLengthBuffer = Buffer.alloc(4);
	messageLengthBuffer.writeUInt32LE(params.message.length);
	const attestationLengthBuffer = Buffer.alloc(4);
	attestationLengthBuffer.writeUInt32LE(params.attestation.length);

	const data = Buffer.concat([
		discriminator,
		messageLengthBuffer,
		params.message,
		attestationLengthBuffer,
		params.attestation
	]);

	// Account list
	const accounts = [
		{ pubkey: recipient, name: 'recipient' },
		{ pubkey: usdcMint, name: 'mintTokenMint' },
		{ pubkey: messageTransmitterProgram, name: 'messageTransmitterProgram' },
		{ pubkey: messageTransmitterAuthority, name: 'messageTransmitterAuthority' },
		{ pubkey: tokenMessengerProgram, name: 'tokenMessengerProgram' },
		{ pubkey: tokenMessengerMinter, name: 'tokenMessengerMinter' },
		{ pubkey: localToken, name: 'localToken' },
		{ pubkey: SystemProgram.programId, name: 'systemProgram' }
	];

	const instruction = new TransactionInstruction({
		programId: messageTransmitterProgram,
		keys: accounts.map((acc) => ({
			pubkey: acc.pubkey,
			isSigner: acc.name === 'recipient',
			isWritable: ['recipient', 'mintTokenMint'].includes(acc.name)
		})),
		data
	});

	return { instruction, accounts };
}

/**
 * Parse MessageSent event from Solana transaction
 * Note: This requires parsing the transaction logs
 */
export function parseSolanaMessageEvent(logs: string[]): {
	message: Buffer;
	nonce: bigint;
} | null {
	// Look for the MessageSent log
	// The exact format depends on the CCTP program implementation
	for (const log of logs) {
		if (log.includes('MessageSent')) {
			try {
				// Parse the log to extract message and nonce
				// This is a placeholder - actual parsing depends on log format
				const match = log.match(/message: ([a-fA-F0-9]+), nonce: (\d+)/);
				if (match) {
					return {
						message: Buffer.from(match[1], 'hex'),
						nonce: BigInt(match[2])
					};
				}
			} catch {
				// Not the log we're looking for
			}
		}
	}

	return null;
}

/**
 * Get the USDC token account for a wallet
 */
export function getUsdcTokenAccount(wallet: PublicKey): PublicKey {
	const [tokenAccount] = PublicKey.findProgramAddressSync(
		[wallet.toBuffer(), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(), new PublicKey(SOLANA_USDC_MINT).toBuffer()],
		new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') // Associated Token Program
	);
	return tokenAccount;
}
