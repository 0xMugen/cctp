-- Migration: Add PostgreSQL LISTEN/NOTIFY triggers for event-driven attestation polling
-- This replaces the naive setInterval polling with event-driven architecture

-- Notify when a transaction needs attestation polling
CREATE OR REPLACE FUNCTION notify_attestation_needed()
RETURNS TRIGGER AS $$
BEGIN
    -- Only notify when status is 'burned' and we have a message_hash to poll
    IF NEW.status = 'burned' AND NEW.message_hash IS NOT NULL AND NEW.attestation_status = 'pending' THEN
        PERFORM pg_notify('attestation_needed', json_build_object(
            'id', NEW.id,
            'message_hash', NEW.message_hash,
            'attempts', NEW.attestation_attempts
        )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on INSERT and UPDATE to bridge_transactions
DROP TRIGGER IF EXISTS tr_attestation_needed ON bridge_transactions;
CREATE TRIGGER tr_attestation_needed
AFTER INSERT OR UPDATE ON bridge_transactions
FOR EACH ROW EXECUTE FUNCTION notify_attestation_needed();

-- Notify frontend clients of status changes via SSE
CREATE OR REPLACE FUNCTION notify_bridge_status_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('bridge_status_changed', json_build_object(
        'id', NEW.id,
        'status', NEW.status,
        'attestation_status', NEW.attestation_status,
        'has_attestation', NEW.attestation IS NOT NULL,
        'burn_tx_hash', NEW.burn_tx_hash,
        'mint_tx_hash', NEW.mint_tx_hash,
        'error_message', NEW.error_message
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only trigger when status or attestation_status actually changes
DROP TRIGGER IF EXISTS tr_bridge_status_changed ON bridge_transactions;
CREATE TRIGGER tr_bridge_status_changed
AFTER UPDATE ON bridge_transactions
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status
   OR OLD.attestation_status IS DISTINCT FROM NEW.attestation_status
   OR OLD.attestation IS DISTINCT FROM NEW.attestation)
EXECUTE FUNCTION notify_bridge_status_change();

-- Add index for efficient pending attestation queries
CREATE INDEX IF NOT EXISTS idx_bridge_tx_pending_attestation
ON bridge_transactions(created_at)
WHERE attestation_status = 'pending' AND status = 'burned' AND message_hash IS NOT NULL;
