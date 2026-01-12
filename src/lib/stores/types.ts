// Shared types for the bridge frontend

export interface ChainConfig {
	chainId: string;
	domainId: number;
	name: string;
	type: 'evm' | 'solana' | 'starknet';
	usdc: string;
	explorerUrl?: string;
}

export type BridgeStatus = 'initiated' | 'burned' | 'attested' | 'minting' | 'completed' | 'failed';

export type AttestationStatus = 'pending' | 'complete' | 'failed';

export type BridgeStep =
	| 'idle'
	| 'fetching_quote'
	| 'approving'
	| 'initiating'
	| 'burning'
	| 'waiting_attestation'
	| 'minting'
	| 'completed'
	| 'failed';

export interface Quote {
	inputAmount: string;
	outputAmount: string;
	fee: string;
	estimatedTime: string;
	rate: string;
}

export interface BridgeTransaction {
	bridgeId: string;
	status: BridgeStatus;
	attestationStatus: AttestationStatus;
	sourceDomain: number;
	destDomain: number;
	amount: string;
	recipientAddress: string;
	burnTxHash: string | null;
	mintTxHash: string | null;
	attestation: string | null;
	errorMessage: string | null;
	mintTxData?: MintTxData;
}

export interface BurnTxData {
	evm?: {
		to: string;
		data: string;
		chainId: number;
	};
	// EVM approve transaction (if user needs to approve TokenMessenger)
	evmApprove?: {
		to: string; // USDC token address
		data: string; // approve(spender, amount) encoded
		chainId: number;
	};
	starknet?: {
		calls: Array<{
			contractAddress: string;
			entrypoint: string;
			calldata: string[];
		}>;
	};
}

export interface MintTxData {
	evm?: {
		to: string;
		data: string;
		chainId: number;
	};
	starknet?: {
		calls: Array<{
			contractAddress: string;
			entrypoint: string;
			calldata: string[];
		}>;
	};
}

export interface InitiateBridgeResponse {
	bridgeId: string;
	txData: BurnTxData;
}

export interface BridgeStatusResponse {
	bridgeId: string;
	status: BridgeStatus;
	attestationStatus: AttestationStatus;
	sourceDomain: number;
	destDomain: number;
	amount: string;
	recipientAddress: string;
	burnTxHash: string | null;
	mintTxHash: string | null;
	attestation: string | null;
	errorMessage: string | null;
	mintTxData: MintTxData | null;
	relayerWillMint?: boolean;
}

// Activity types
export interface ActivityTransaction {
	id: string;
	status: BridgeStatus;
	attestationStatus: AttestationStatus;
	sourceDomainId: number;
	destDomainId: number;
	amount: string;
	recipientAddress: string;
	burnTxHash: string | null;
	mintTxHash: string | null;
	createdAt: string;
	updatedAt: string;
	// For claimable transactions (attested + EVM destination)
	mintTxData?: MintTxData;
}

export interface ActivityResponse {
	transactions: ActivityTransaction[];
	total: number;
	hasMore: boolean;
}
