import { env } from '$env/dynamic/private';

export type ChainType = 'evm' | 'solana' | 'starknet';

export interface ChainConfig {
	chainId: string;
	domainId: number;
	name: string;
	type: ChainType;
	tokenMessenger: string;
	messageTransmitter: string;
	usdc: string;
	rpcUrl?: string;
	explorerUrl?: string;
}

// Starknet is always one side of every bridge
export const STARKNET_DOMAIN_ID = 25;

// CCTP V2 Domain IDs
export const DOMAIN_IDS = {
	ETHEREUM: 0,
	AVALANCHE: 1,
	OPTIMISM: 2,
	ARBITRUM: 3,
	SOLANA: 5,
	BASE: 6,
	POLYGON: 7,
	STARKNET: 25
} as const;

// Chain configurations (mainnet)
export const CHAINS: Record<number, ChainConfig> = {
	[DOMAIN_IDS.ETHEREUM]: {
		chainId: '1',
		domainId: DOMAIN_IDS.ETHEREUM,
		name: 'Ethereum',
		type: 'evm',
		tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d', // V2
		messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64', // V2
		usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
		explorerUrl: 'https://etherscan.io'
	},
	[DOMAIN_IDS.OPTIMISM]: {
		chainId: '10',
		domainId: DOMAIN_IDS.OPTIMISM,
		name: 'Optimism',
		type: 'evm',
		tokenMessenger: '0x2B4069517957735bE00ceE0fadAE88a26365528f',
		messageTransmitter: '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8',
		usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
		explorerUrl: 'https://optimistic.etherscan.io'
	},
	[DOMAIN_IDS.ARBITRUM]: {
		chainId: '42161',
		domainId: DOMAIN_IDS.ARBITRUM,
		name: 'Arbitrum',
		type: 'evm',
		tokenMessenger: '0x19330d10D9Cc8751218eaf51E8885D058642E08A',
		messageTransmitter: '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca',
		usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
		explorerUrl: 'https://arbiscan.io'
	},
	[DOMAIN_IDS.BASE]: {
		chainId: '8453',
		domainId: DOMAIN_IDS.BASE,
		name: 'Base',
		type: 'evm',
		tokenMessenger: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
		messageTransmitter: '0xAD09780d193884d503182aD4588450C416D6F9D4',
		usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
		explorerUrl: 'https://basescan.org'
	},
	[DOMAIN_IDS.POLYGON]: {
		chainId: '137',
		domainId: DOMAIN_IDS.POLYGON,
		name: 'Polygon',
		type: 'evm',
		tokenMessenger: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
		messageTransmitter: '0xF3be9355363857F3e001be68856A2f96b4C39Ba9',
		usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
		explorerUrl: 'https://polygonscan.com'
	},
	[DOMAIN_IDS.SOLANA]: {
		chainId: 'solana-mainnet',
		domainId: DOMAIN_IDS.SOLANA,
		name: 'Solana',
		type: 'solana',
		tokenMessenger: 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3',
		messageTransmitter: 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd',
		usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
		explorerUrl: 'https://solscan.io'
	},
	[DOMAIN_IDS.STARKNET]: {
		chainId: 'starknet-mainnet',
		domainId: DOMAIN_IDS.STARKNET,
		name: 'Starknet',
		type: 'starknet',
		tokenMessenger: '0x07d421B9cA8aA32DF259965cDA8ACb93F7599F69209A41872AE84638B2A20F2a',
		messageTransmitter: '0x02EBB5777B6dD8B26ea11D68Fdf1D2c85cD2099335328Be845a28c77A8AEf183',
		usdc: '0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb',
		explorerUrl: 'https://starkscan.co'
	}
};

// Testnet chain configurations
export const TESTNET_CHAINS: Record<number, ChainConfig> = {
	[DOMAIN_IDS.ETHEREUM]: {
		chainId: '11155111', // Sepolia
		domainId: DOMAIN_IDS.ETHEREUM,
		name: 'Ethereum Sepolia',
		type: 'evm',
		tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
		messageTransmitter: '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD',
		usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
		explorerUrl: 'https://sepolia.etherscan.io'
	},
	[DOMAIN_IDS.BASE]: {
		chainId: '84532', // Base Sepolia
		domainId: DOMAIN_IDS.BASE,
		name: 'Base Sepolia',
		type: 'evm',
		tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
		messageTransmitter: '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD',
		usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
		explorerUrl: 'https://sepolia.basescan.org'
	},
	[DOMAIN_IDS.STARKNET]: {
		chainId: 'starknet-sepolia',
		domainId: DOMAIN_IDS.STARKNET,
		name: 'Starknet Sepolia',
		type: 'starknet',
		tokenMessenger: '0x04bDdE1E09a4B09a2F95d893D94a967b7717eB85A3f6dEcA8c080Ee01fBc3370',
		messageTransmitter: '0x04db7926C64f1f32a840F3Fa95cB551f3801a3600Bae87aF87807A54DCE12Fe8',
		usdc: '0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343',
		explorerUrl: 'https://sepolia.starkscan.co'
	}
};

// Circle Iris API endpoints
export const IRIS_API = {
	mainnet: 'https://iris-api.circle.com',
	testnet: 'https://iris-api-sandbox.circle.com'
} as const;

// Get API host based on environment
export function getIrisApiHost(): string {
	const isTestnet = env.CCTP_TESTNET === 'true';
	return isTestnet ? IRIS_API.testnet : IRIS_API.mainnet;
}

// Get chain config by domain ID
export function getChainConfig(domainId: number): ChainConfig | undefined {
	const isTestnet = env.CCTP_TESTNET === 'true';
	const chains = isTestnet ? TESTNET_CHAINS : CHAINS;
	return chains[domainId];
}

// Get all supported chains (only those with Starknet pairs)
export function getSupportedChains(): ChainConfig[] {
	const isTestnet = env.CCTP_TESTNET === 'true';
	const chains = isTestnet ? TESTNET_CHAINS : CHAINS;
	return Object.values(chains);
}

// Validate that a bridge involves Starknet
export function isValidBridgePair(sourceDomain: number, destDomain: number): boolean {
	// One side must be Starknet
	return sourceDomain === STARKNET_DOMAIN_ID || destDomain === STARKNET_DOMAIN_ID;
}

// Get the non-Starknet chain in a bridge pair
export function getCounterpartyDomain(sourceDomain: number, destDomain: number): number {
	if (sourceDomain === STARKNET_DOMAIN_ID) return destDomain;
	if (destDomain === STARKNET_DOMAIN_ID) return sourceDomain;
	throw new Error('Invalid bridge pair: must involve Starknet');
}
