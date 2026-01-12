-- Migration: 0008_fix_starknet_addresses
-- Description: Fix Starknet CCTP contract addresses and add testnet chains
-- The original migration had placeholder/incorrect Starknet addresses

-- Update Starknet mainnet addresses to correct values
UPDATE supported_chains
SET
    token_messenger = '0x07d421B9cA8aA32DF259965cDA8ACb93F7599F69209A41872AE84638B2A20F2a',
    message_transmitter = '0x02EBB5777B6dD8B26ea11D68Fdf1D2c85cD2099335328Be845a28c77A8AEf183',
    usdc_address = '0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb'
WHERE domain_id = 25 AND is_testnet = false;

-- Fix schema: domain_id should be unique per network type (mainnet/testnet), not globally
-- Drop the existing unique constraint on domain_id
ALTER TABLE supported_chains DROP CONSTRAINT IF EXISTS supported_chains_domain_id_key;

-- Add composite unique constraint on (domain_id, is_testnet)
ALTER TABLE supported_chains ADD CONSTRAINT supported_chains_domain_network_unique UNIQUE (domain_id, is_testnet);

-- Add testnet chains (Sepolia networks)
INSERT INTO supported_chains (chain_id, domain_id, name, chain_type, token_messenger, message_transmitter, usdc_address, explorer_url, is_testnet, is_enabled)
VALUES
-- Ethereum Sepolia
('11155111', 0, 'Ethereum Sepolia', 'evm', '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5', '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'https://sepolia.etherscan.io', true, true),
-- Base Sepolia
('84532', 6, 'Base Sepolia', 'evm', '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5', '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'https://sepolia.basescan.org', true, true),
-- Starknet Sepolia
('starknet-sepolia', 25, 'Starknet Sepolia', 'starknet', '0x04bDdE1E09a4B09a2F95d893D94a967b7717eB85A3f6dEcA8c080Ee01fBc3370', '0x04db7926C64f1f32a840F3Fa95cB551f3801a3600Bae87aF87807A54DCE12Fe8', '0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343', 'https://sepolia.starkscan.co', true, true);

-- Rollback
-- ALTER TABLE supported_chains DROP CONSTRAINT IF EXISTS supported_chains_domain_network_unique;
-- ALTER TABLE supported_chains ADD CONSTRAINT supported_chains_domain_id_key UNIQUE (domain_id);
-- UPDATE supported_chains SET token_messenger = '0x06a1d71e3815f63282f70e35ff3dc2e8cbb6c7e90880bb1e12a1c30ecb92b3d5', message_transmitter = '0x05ab68926f5c46e33a4b39f6fb1c99a6e8d11ec0a6a7f3c8c3b1e3a5e0d3b2c1', usdc_address = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8' WHERE domain_id = 25 AND is_testnet = false;
-- DELETE FROM supported_chains WHERE is_testnet = true;
