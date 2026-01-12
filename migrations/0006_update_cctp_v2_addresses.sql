-- Migration: 0006_update_cctp_v2_addresses
-- Description: Update EVM chains to use CCTP V2 contract addresses
-- The V1 addresses were causing transactions to fail because they use the deprecated protocol

-- CCTP V2 uses the same Token Messenger and Message Transmitter addresses across all EVM chains
UPDATE supported_chains
SET
    token_messenger = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    message_transmitter = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'
WHERE chain_type = 'evm';

-- Rollback
-- UPDATE supported_chains SET token_messenger = '0xbd3fa81b58ba92a82136038b25adec7066af3155', message_transmitter = '0x0a992d191deec32afe36203ad87d7d289a738f81' WHERE chain_id = '1';
-- UPDATE supported_chains SET token_messenger = '0x2B4069517957735bE00ceE0fadAE88a26365528f', message_transmitter = '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8' WHERE chain_id = '10';
-- UPDATE supported_chains SET token_messenger = '0x19330d10D9Cc8751218eaf51E8885D058642E08A', message_transmitter = '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca' WHERE chain_id = '42161';
-- UPDATE supported_chains SET token_messenger = '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962', message_transmitter = '0xAD09780d193884d503182aD4588450C416D6F9D4' WHERE chain_id = '8453';
-- UPDATE supported_chains SET token_messenger = '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE', message_transmitter = '0xF3be9355363857F3e001be68856A2f96b4C39Ba9' WHERE chain_id = '137';
