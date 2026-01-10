-- Migration: 0002_bridge_tables
-- Description: Create tables for CCTP bridge transactions

-- Chain type enum
CREATE TYPE chain_type AS ENUM ('evm', 'solana', 'starknet');

-- Supported chains configuration
CREATE TABLE supported_chains (
    id SERIAL PRIMARY KEY,
    chain_id VARCHAR(20) NOT NULL UNIQUE,  -- String for non-EVM (e.g., 'solana-mainnet')
    domain_id INTEGER NOT NULL UNIQUE,
    name VARCHAR(50) NOT NULL,
    chain_type chain_type NOT NULL,
    token_messenger VARCHAR(66) NOT NULL,  -- 66 for Starknet addresses
    message_transmitter VARCHAR(66) NOT NULL,
    usdc_address VARCHAR(66) NOT NULL,
    rpc_url VARCHAR(255),
    is_testnet BOOLEAN DEFAULT false,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bridge transactions
CREATE TABLE bridge_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address VARCHAR(66) NOT NULL,
    source_domain_id INTEGER NOT NULL,
    dest_domain_id INTEGER NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    recipient_address VARCHAR(66) NOT NULL,

    -- Source chain transaction
    burn_tx_hash VARCHAR(100),  -- Longer for Starknet tx hashes
    message_hash VARCHAR(66),
    message_bytes TEXT,
    nonce BIGINT,

    -- Attestation (fetched by backend)
    attestation TEXT,
    attestation_status VARCHAR(20) DEFAULT 'pending',
    attestation_attempts INTEGER DEFAULT 0,
    last_attestation_check TIMESTAMP,

    -- Destination chain transaction
    mint_tx_hash VARCHAR(100),

    -- Status: initiated → burned → attested → minting → completed | failed
    status VARCHAR(20) DEFAULT 'initiated',
    error_message TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_bridge_tx_user ON bridge_transactions(user_address);
CREATE INDEX idx_bridge_tx_status ON bridge_transactions(status);
CREATE INDEX idx_bridge_tx_message_hash ON bridge_transactions(message_hash);
CREATE INDEX idx_bridge_tx_attestation_pending ON bridge_transactions(attestation_status)
    WHERE attestation_status = 'pending';
CREATE INDEX idx_bridge_tx_created ON bridge_transactions(created_at);

-- Insert default supported chains (mainnet)
INSERT INTO supported_chains (chain_id, domain_id, name, chain_type, token_messenger, message_transmitter, usdc_address, is_testnet) VALUES
-- EVM Chains (V2 addresses - to be updated with actual V2 contracts)
('1', 0, 'Ethereum', 'evm', '0xbd3fa81b58ba92a82136038b25adec7066af3155', '0x0a992d191deec32afe36203ad87d7d289a738f81', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', false),
('10', 2, 'Optimism', 'evm', '0x2B4069517957735bE00ceE0fadAE88a26365528f', '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8', '0x0b2c639c533813f4aa9d7837caf62653d097ff85', false),
('42161', 3, 'Arbitrum', 'evm', '0x19330d10D9Cc8751218eaf51E8885D058642E08A', '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', false),
('8453', 6, 'Base', 'evm', '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962', '0xAD09780d193884d503182aD4588450C416D6F9D4', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', false),
('137', 7, 'Polygon', 'evm', '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE', '0xF3be9355363857F3e001be68856A2f96b4C39Ba9', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', false),
-- Solana
('solana-mainnet', 5, 'Solana', 'solana', 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3', 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', false),
-- Starknet
('starknet-mainnet', 25, 'Starknet', 'starknet', '0x06a1d71e3815f63282f70e35ff3dc2e8cbb6c7e90880bb1e12a1c30ecb92b3d5', '0x05ab68926f5c46e33a4b39f6fb1c99a6e8d11ec0a6a7f3c8c3b1e3a5e0d3b2c1', '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8', false);

-- Rollback
-- DROP TABLE IF EXISTS bridge_transactions;
-- DROP TABLE IF EXISTS supported_chains;
-- DROP TYPE IF EXISTS chain_type;
