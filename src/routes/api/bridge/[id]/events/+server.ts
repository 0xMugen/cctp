import type { RequestHandler } from './$types';
import { pool, type PoolClient } from '$lib/server/database';
import { cctpService } from '$lib/server/cctp/service.js';

/**
 * GET /api/bridge/[id]/events
 * Server-Sent Events endpoint for real-time bridge status updates
 */
export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	// Verify bridge exists
	const tx = await cctpService.getTransaction(id);
	if (!tx) {
		return new Response(JSON.stringify({ error: 'Bridge transaction not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let client: PoolClient | null = null;
	let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	let isClosing = false;

	const cleanup = () => {
		if (isClosing) return;
		isClosing = true;

		console.log(`Cleaning up SSE connection for bridge ${id}`);
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval);
			heartbeatInterval = null;
		}
		if (client) {
			client.query('UNLISTEN bridge_status_changed').catch(() => {});
			client.release();
			client = null;
		}
	};

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			const sendEvent = (data: object) => {
				if (!isClosing) {
					try {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
					} catch {
						// Stream might be closed, cleanup will handle it
					}
				}
			};

			try {
				// Get dedicated connection for LISTEN
				client = await pool.connect();
				await client.query('LISTEN bridge_status_changed');

				// Send initial status immediately
				const initialTx = await cctpService.getTransaction(id);
				if (initialTx) {
					sendEvent({
						type: 'initial',
						id: initialTx.id,
						status: initialTx.status,
						attestationStatus: initialTx.attestationStatus,
						hasAttestation: initialTx.attestation !== null,
						burnTxHash: initialTx.burnTxHash,
						mintTxHash: initialTx.mintTxHash,
						errorMessage: initialTx.errorMessage
					});
				}

				// Listen for status changes
				client.on('notification', (msg) => {
					if (msg.channel === 'bridge_status_changed' && msg.payload) {
						try {
							const data = JSON.parse(msg.payload);
							if (data.id === id) {
								sendEvent({ type: 'update', ...data });
								if (data.status === 'completed' || data.status === 'failed') {
									sendEvent({ type: 'close', reason: `Bridge ${data.status}` });
									cleanup();
									controller.close();
								}
							}
						} catch (error) {
							console.error('Error parsing bridge status notification:', error);
						}
					}
				});

				// Handle connection errors
				client.on('error', (error) => {
					console.error('SSE connection error:', error);
					sendEvent({ type: 'error', message: 'Connection error' });
					cleanup();
					controller.close();
				});

				heartbeatInterval = setInterval(() => {
					sendEvent({ type: 'heartbeat' });
				}, 30000);
			} catch (error) {
				console.error('Error setting up SSE stream:', error);
				cleanup();
				controller.error(error);
			}
		},

		cancel() {
			console.log(`SSE client disconnected for bridge ${id}`);
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
