import { cctpService } from './service.js';

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

/**
 * Poll pending attestations from Circle's API
 * This function should be called periodically to check for attestations
 */
export async function pollPendingAttestations(): Promise<{
	processed: number;
	attested: number;
	errors: number;
}> {
	if (isPolling) {
		return { processed: 0, attested: 0, errors: 0 };
	}

	isPolling = true;
	let processed = 0;
	let attested = 0;
	let errors = 0;

	try {
		const pending = await cctpService.getPendingAttestations();

		for (const tx of pending) {
			processed++;
			try {
				const attestation = await cctpService.checkAttestation(tx.id);
				if (attestation) {
					attested++;
					console.log(`Attestation received for bridge ${tx.id}`);
				}
			} catch (error) {
				errors++;
				console.error(`Error polling attestation for ${tx.id}:`, error);
			}
		}

		if (processed > 0) {
			console.log(
				`Attestation poll: ${processed} checked, ${attested} attested, ${errors} errors`
			);
		}
	} catch (error) {
		console.error('Error in attestation polling:', error);
	} finally {
		isPolling = false;
	}

	return { processed, attested, errors };
}

/**
 * Start the background attestation polling
 * @param intervalMs - Polling interval in milliseconds (default: 5000)
 */
export function startAttestationPolling(intervalMs: number = 5000): void {
	if (pollingInterval) {
		console.log('Attestation polling already running');
		return;
	}

	console.log(`Starting attestation polling every ${intervalMs}ms`);
	pollingInterval = setInterval(pollPendingAttestations, intervalMs);

	// Run immediately on start
	pollPendingAttestations();
}

/**
 * Stop the background attestation polling
 */
export function stopAttestationPolling(): void {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
		console.log('Attestation polling stopped');
	}
}

/**
 * Check if polling is currently active
 */
export function isPollingActive(): boolean {
	return pollingInterval !== null;
}
