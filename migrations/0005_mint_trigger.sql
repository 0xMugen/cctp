-- Migration: 0005_mint_trigger
-- Description: Add trigger to notify mint worker when attestation is received

-- Function to notify mint worker when a transaction becomes attested
CREATE OR REPLACE FUNCTION notify_mint_needed()
RETURNS TRIGGER AS $$
BEGIN
    -- Only notify when transitioning to attested status with attestation data
    IF NEW.attestation IS NOT NULL
       AND NEW.status = 'attested'
       AND (OLD.status IS NULL OR OLD.status != 'attested') THEN
        PERFORM pg_notify('mint_needed', json_build_object(
            'id', NEW.id,
            'dest_domain_id', NEW.dest_domain_id
        )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on bridge_transactions
CREATE TRIGGER bridge_tx_mint_trigger
AFTER UPDATE ON bridge_transactions
FOR EACH ROW
EXECUTE FUNCTION notify_mint_needed();
