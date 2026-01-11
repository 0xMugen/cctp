-- Migration: 0007_add_explorer_url
-- Description: Add explorer_url column to supported_chains table

-- Add explorer_url column
ALTER TABLE supported_chains ADD COLUMN explorer_url VARCHAR(255);

-- Populate explorer URLs for existing chains (mainnet)
UPDATE supported_chains SET explorer_url = 'https://etherscan.io' WHERE domain_id = 0;
UPDATE supported_chains SET explorer_url = 'https://optimistic.etherscan.io' WHERE domain_id = 2;
UPDATE supported_chains SET explorer_url = 'https://arbiscan.io' WHERE domain_id = 3;
UPDATE supported_chains SET explorer_url = 'https://solscan.io' WHERE domain_id = 5;
UPDATE supported_chains SET explorer_url = 'https://basescan.org' WHERE domain_id = 6;
UPDATE supported_chains SET explorer_url = 'https://polygonscan.com' WHERE domain_id = 7;
UPDATE supported_chains SET explorer_url = 'https://starkscan.co' WHERE domain_id = 25;

-- Rollback
-- ALTER TABLE supported_chains DROP COLUMN explorer_url;
