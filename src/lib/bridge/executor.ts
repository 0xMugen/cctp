import { get } from 'svelte/store';
import { wagmiConfig, evmAddress } from '$lib/stores/evm';
import { starknetAddress, starknetAccount } from '$lib/stores/starknet';
import {
	activeBridgeId,
	bridgeStep,
	bridgeError,
	bridgeStatus,
	connectSSE,
	isFastTransfer
} from '$lib/stores/bridge';
import type {
	ChainConfig,
	BurnTxData,
	InitiateBridgeResponse,
	BridgeStatusResponse
} from '$lib/stores/types';
import type { WalletAccount } from 'starknet';

interface ExecuteBridgeParams {
	sourceChain: ChainConfig;
	destChain: ChainConfig;
	amount: string; // In display units (e.g., "100" for 100 USDC)
}

/**
 * Sanitize error messages to remove long hex data and request details
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

/**
 * Execute a bridge transaction
 */
export async function executeBridge(params: ExecuteBridgeParams): Promise<void> {
	const { sourceChain, destChain, amount } = params;

	// Reset any previous errors
	bridgeError.set(null);

	try {
		const amountInSmallestUnit = Math.floor(parseFloat(amount) * 1e6).toString();

		const evmAddr = get(evmAddress);
		const snAddr = get(starknetAddress);

		const sender = sourceChain.type === 'starknet' ? snAddr : evmAddr;
		const recipient = destChain.type === 'starknet' ? snAddr : evmAddr;

		if (!sender) {
			throw new Error(
				`Please connect your ${sourceChain.type === 'starknet' ? 'Starknet' : 'EVM'} wallet`
			);
		}
		if (!recipient) {
			throw new Error(
				`Please connect your ${destChain.type === 'starknet' ? 'Starknet' : 'EVM'} wallet`
			);
		}

		// Step 1: Initiate bridge
		bridgeStep.set('initiating');
		const initResponse = await initiateBridge({
			sourceDomain: sourceChain.domainId,
			destDomain: destChain.domainId,
			amount: amountInSmallestUnit,
			sender,
			recipient,
			isFastTransfer: get(isFastTransfer)
		});

		const { bridgeId, txData } = initResponse;
		activeBridgeId.set(bridgeId);

		// Connect to SSE for real-time updates
		connectSSE(bridgeId);

		// Step 2: Execute burn transaction
		bridgeStep.set('burning');
		let burnTxHash: string;

		if (sourceChain.type === 'evm' && txData.evm) {
			burnTxHash = await executeEvmBurn(txData);
		} else if (sourceChain.type === 'starknet' && txData.starknet) {
			const account = get(starknetAccount);
			if (!account) {
				throw new Error('Starknet account not available');
			}
			burnTxHash = await executeStarknetBurn(txData, account);
		} else {
			throw new Error('Unsupported source chain type');
		}

		// Step 3: Report burn to backend
		await reportBurnTransaction(bridgeId, burnTxHash);
		bridgeStep.set('waiting_attestation');

		// Step 4: Wait for attestation
		const attestedStatus = await waitForAttestation(bridgeId);

		const { refreshActivity } = await import('$lib/stores/activity');
		refreshActivity();

		// Step 5: Execute mint transaction (or wait for relayer)
		if (attestedStatus.relayerWillMint) {
			bridgeStep.set('minting');
			await waitForCompletion(bridgeId);
			bridgeStep.set('completed');
		} else {
			bridgeStep.set('minting');
			let mintTxHash: string;

			if (destChain.type === 'evm' && attestedStatus.mintTxData?.evm) {
				mintTxHash = await executeEvmMint(attestedStatus.mintTxData);
			} else if (destChain.type === 'starknet' && attestedStatus.mintTxData?.starknet) {
				const account = get(starknetAccount);
				if (!account) {
					throw new Error('Starknet account not available');
				}
				mintTxHash = await executeStarknetMint(attestedStatus.mintTxData, account);
			} else {
				throw new Error('Mint transaction data not available');
			}

			// Step 6: Report completion
			await reportMintTransaction(bridgeId, mintTxHash);
			bridgeStep.set('completed');
		}
	} catch (error) {
		console.error('Bridge execution failed:', error);
		bridgeStep.set('failed');
		bridgeError.set(sanitizeErrorMessage(error));
		throw error;
	}
}

/**
 * Initiate a bridge via the API
 */
async function initiateBridge(params: {
	sourceDomain: number;
	destDomain: number;
	amount: string;
	sender: string;
	recipient: string;
	isFastTransfer?: boolean;
}): Promise<InitiateBridgeResponse> {
	const response = await fetch('/api/bridge/initiate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params)
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.error || 'Failed to initiate bridge');
	}

	return response.json();
}

/**
 * Execute EVM burn transaction (with approval if needed)
 */
async function executeEvmBurn(txData: BurnTxData): Promise<string> {
	const config = get(wagmiConfig);
	if (!config || !txData.evm) {
		throw new Error('EVM not configured');
	}

	const { sendTransaction, waitForTransactionReceipt, switchChain, readContract, getAccount } =
		await import('@wagmi/core');

	const targetChainId = txData.evm.chainId;

	// Ensure we're on the correct chain and wait for it to complete
	const account = getAccount(config);
	if (account.chainId !== targetChainId) {
		try {
			await switchChain(config, { chainId: targetChainId });
		} catch (e) {
			console.error('Failed to switch chain:', e);
			throw new Error(`Please switch to the correct network (chain ID: ${targetChainId})`);
		}
	}

	// Check if we need to approve first
	if (txData.evmApprove) {
		const userAddress = get(evmAddress);
		if (userAddress) {
			// Check current allowance
			const allowance = await readContract(config, {
				address: txData.evmApprove.to as `0x${string}`,
				abi: [
					{
						name: 'allowance',
						type: 'function',
						stateMutability: 'view',
						inputs: [
							{ name: 'owner', type: 'address' },
							{ name: 'spender', type: 'address' }
						],
						outputs: [{ name: '', type: 'uint256' }]
					}
				],
				functionName: 'allowance',
				args: [userAddress as `0x${string}`, txData.evm.to as `0x${string}`]
			});

			// Parse transfer amount from burn data (first 32 bytes after function selector)
			const transferAmount = BigInt('0x' + txData.evm.data.slice(10, 74));

			if ((allowance as bigint) < transferAmount) {
				// Need to approve - update bridge step
				bridgeStep.set('approving');

				const approveHash = await sendTransaction(config, {
					to: txData.evmApprove.to as `0x${string}`,
					data: txData.evmApprove.data as `0x${string}`,
					value: 0n
				});

				await waitForTransactionReceipt(config, { hash: approveHash });

				// Back to burning step
				bridgeStep.set('burning');
			}
		}
	}

	// Execute the burn transaction
	const hash = await sendTransaction(config, {
		to: txData.evm.to as `0x${string}`,
		data: txData.evm.data as `0x${string}`,
		value: 0n
	});

	await waitForTransactionReceipt(config, { hash });

	return hash;
}

/**
 * Execute Starknet burn transaction
 */
async function executeStarknetBurn(txData: BurnTxData, account: WalletAccount): Promise<string> {
	if (!txData.starknet?.calls) {
		throw new Error('No Starknet transaction data');
	}

	const result = await account.execute(txData.starknet.calls);
	await account.waitForTransaction(result.transaction_hash);

	return result.transaction_hash;
}

/**
 * Report burn transaction to backend
 */
async function reportBurnTransaction(bridgeId: string, txHash: string): Promise<void> {
	const response = await fetch(`/api/bridge/${bridgeId}/burn`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ txHash })
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.error || 'Failed to report burn transaction');
	}
}

/**
 * Wait for attestation to be ready
 */
async function waitForAttestation(
	bridgeId: string,
	maxAttempts = 120,
	intervalMs = 5000
): Promise<BridgeStatusResponse> {
	for (let i = 0; i < maxAttempts; i++) {
		const response = await fetch(`/api/bridge/${bridgeId}/status`);

		if (!response.ok) {
			throw new Error('Failed to fetch bridge status');
		}

		const status: BridgeStatusResponse = await response.json();
		bridgeStatus.set(status);

		// Ready if attestation complete AND either relayer will mint OR we have mintTxData
		if (status.attestationStatus === 'complete' && (status.relayerWillMint || status.mintTxData)) {
			return status;
		}

		if (status.status === 'failed') {
			throw new Error(status.errorMessage || 'Bridge failed');
		}

		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new Error('Attestation timeout');
}

/**
 * Wait for relayer to complete the mint
 */
async function waitForCompletion(
	bridgeId: string,
	maxAttempts = 120,
	intervalMs = 5000
): Promise<BridgeStatusResponse> {
	for (let i = 0; i < maxAttempts; i++) {
		const response = await fetch(`/api/bridge/${bridgeId}/status`);

		if (!response.ok) {
			throw new Error('Failed to fetch bridge status');
		}

		const status: BridgeStatusResponse = await response.json();
		bridgeStatus.set(status);

		if (status.status === 'completed') {
			return status;
		}

		if (status.status === 'failed') {
			throw new Error(status.errorMessage || 'Bridge failed');
		}

		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new Error('Mint timeout - relayer may still complete the transaction');
}

/**
 * Execute EVM mint transaction
 */
async function executeEvmMint(mintTxData: BurnTxData): Promise<string> {
	const config = get(wagmiConfig);
	if (!config || !mintTxData.evm) {
		throw new Error('EVM not configured');
	}

	const { sendTransaction, waitForTransactionReceipt, switchChain, getAccount } = await import(
		'@wagmi/core'
	);

	const targetChainId = mintTxData.evm.chainId;

	// Ensure we're on the correct chain
	const account = getAccount(config);
	if (account.chainId !== targetChainId) {
		try {
			await switchChain(config, { chainId: targetChainId });
		} catch (e) {
			console.error('Failed to switch chain:', e);
			throw new Error(`Please switch to the correct network (chain ID: ${targetChainId})`);
		}
	}

	// Send transaction
	const hash = await sendTransaction(config, {
		to: mintTxData.evm.to as `0x${string}`,
		data: mintTxData.evm.data as `0x${string}`,
		value: 0n
	});

	// Wait for confirmation
	await waitForTransactionReceipt(config, { hash });

	return hash;
}

/**
 * Execute Starknet mint transaction
 */
async function executeStarknetMint(
	mintTxData: BurnTxData,
	account: WalletAccount
): Promise<string> {
	if (!mintTxData.starknet?.calls) {
		throw new Error('No Starknet transaction data');
	}

	const result = await account.execute(mintTxData.starknet.calls);
	await account.waitForTransaction(result.transaction_hash);

	return result.transaction_hash;
}

/**
 * Report mint transaction to backend
 */
async function reportMintTransaction(bridgeId: string, txHash: string): Promise<void> {
	const response = await fetch(`/api/bridge/${bridgeId}/complete`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ txHash })
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.error || 'Failed to report mint transaction');
	}
}
