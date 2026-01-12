-- CCTP Bridge Database Schema
-- Generated from migrations

CREATE TABLE IF NOT EXISTS public.migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) NOT NULL
);
