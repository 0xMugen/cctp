-- Migration: 0004_fix_nonce_type
-- Description: Change nonce column from BIGINT to TEXT for 256-bit eventNonce values
--
-- Circle's CCTP API returns eventNonce as a 256-bit hex string which cannot
-- fit in a PostgreSQL BIGINT (64-bit). This migration fixes the column type.

ALTER TABLE bridge_transactions
ALTER COLUMN nonce TYPE TEXT;
