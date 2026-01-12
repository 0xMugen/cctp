import { createServer } from 'http';
import { env } from '$env/dynamic/private';
import { validateConnection } from './database.js';
import { getMigrationStatus, migrateWithLock } from './migrate.js';
import { db } from './db.js';
import { getMigrationState } from './migration-state.js';

interface HealthCheck {
	status: string;
}

interface ReadyCheck {
	status: string;
	message: string;
	database?: string;
	timestamp: string;
	error?: string;
}

// Health endpoint handler
async function handleHealthCheck(): Promise<{ status: number; body: HealthCheck }> {
	const healthCheck: HealthCheck = {
		status: 'healthy'
	};

	let overallHealthy = true;

	try {
		// Database health check
		const isConnected = await validateConnection();

		overallHealthy = isConnected;
	} catch (_error) {
		overallHealthy = false;
	}

	// Set overall status
	healthCheck.status = overallHealthy ? 'healthy' : 'unhealthy';
	const statusCode = overallHealthy ? 200 : 503;

	return { status: statusCode, body: healthCheck };
}

// Ready endpoint handler
async function handleReadyCheck(): Promise<{ status: number; body: ReadyCheck }> {
	try {
		const isConnected = await validateConnection();
		const migrationState = getMigrationState();

		if (!isConnected) {
			return {
				status: 503,
				body: {
					status: 'not ready',
					message: 'Database connection not available',
					database: 'disconnected',
					timestamp: new Date().toISOString()
				}
			};
		}

		// Check migration status
		if (!migrationState.migrationsComplete) {
			return {
				status: 503,
				body: {
					status: 'not ready',
					message: 'Migrations not complete',
					database: 'connected',
					error: migrationState.migrationError?.message || 'Migrations pending',
					timestamp: new Date().toISOString()
				}
			};
		}

		// Everything is ready
		return {
			status: 200,
			body: {
				status: 'ready',
				message: 'Service is ready to accept requests',
				database: 'connected',
				timestamp: new Date().toISOString()
			}
		};
	} catch (error) {
		console.error('Ready check failed:', error);
		return {
			status: 503,
			body: {
				status: 'not ready',
				message: 'Ready check failed',
				error: error instanceof Error ? error.message : 'Unknown error',
				timestamp: new Date().toISOString()
			}
		};
	}
}

// Migration status handler
async function handleMigrationStatus(): Promise<{ status: number; body: unknown }> {
	try {
		const migrationState = getMigrationState();
		const dbMigrationStatus = await getMigrationStatus(db, migrationState.schema);

		return {
			status: 200,
			body: {
				success: true,
				runtime: {
					migrationsComplete: migrationState.migrationsComplete,
					autoMigrateEnabled: migrationState.autoMigrateEnabled,
					schema: migrationState.schema,
					error: migrationState.migrationError?.message || null
				},
				database: {
					pending: dbMigrationStatus.pending,
					applied: dbMigrationStatus.applied,
					locked: dbMigrationStatus.locked
				},
				timestamp: new Date().toISOString()
			}
		};
	} catch (error) {
		console.error('Error getting migration status:', error);
		return {
			status: 500,
			body: {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error occurred'
			}
		};
	}
}

// Manual migration trigger handler
async function handleMigrate(): Promise<{ status: number; body: unknown }> {
	try {
		const schema = env.MIGRATION_SCHEMA || 'public';
		const result = await migrateWithLock(db, {
			schema,
			lockTimeout: parseInt(env.MIGRATION_LOCK_TIMEOUT || '30000')
		});

		if (result.success) {
			return {
				status: 200,
				body: {
					success: true,
					message: 'Migration completed successfully',
					migrationsRun: result.migrationsRun || 0,
					timestamp: new Date().toISOString()
				}
			};
		} else {
			return {
				status: 500,
				body: {
					success: false,
					error: result.error?.message || 'Migration failed',
					timestamp: new Date().toISOString()
				}
			};
		}
	} catch (error) {
		console.error('Error running migrations:', error);
		return {
			status: 500,
			body: {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error occurred'
			}
		};
	}
}

// Create management server
export function createManagementServer(port: number = 3001) {
	const server = createServer(async (req, res) => {
		// Set common headers
		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		// Handle CORS preflight
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url || '/', `http://localhost:${port}`);
		const pathname = url.pathname;

		try {
			// Route handlers
			if (pathname === '/health' && req.method === 'GET') {
				const result = await handleHealthCheck();
				res.writeHead(result.status);
				res.end(JSON.stringify(result.body, null, 2));
			} else if (pathname === '/ready' && req.method === 'GET') {
				const result = await handleReadyCheck();
				res.writeHead(result.status);
				res.end(JSON.stringify(result.body, null, 2));
			} else if (pathname === '/admin/migration-status' && req.method === 'GET') {
				const result = await handleMigrationStatus();
				res.writeHead(result.status);
				res.end(JSON.stringify(result.body, null, 2));
			} else if (pathname === '/admin/migrate' && req.method === 'POST') {
				const result = await handleMigrate();
				res.writeHead(result.status);
				res.end(JSON.stringify(result.body, null, 2));
			} else {
				// 404 for unknown routes
				res.writeHead(404);
				res.end(
					JSON.stringify({
						error: 'Not found',
						message:
							'Available endpoints: GET /health, GET /ready, GET /admin/migration-status, POST /admin/migrate'
					})
				);
			}
		} catch (error) {
			console.error('Management server error:', error);
			res.writeHead(500);
			res.end(
				JSON.stringify({
					error: 'Internal server error',
					message: error instanceof Error ? error.message : 'Unknown error'
				})
			);
		}
	});

	return server;
}

export function startManagementServer(port: number = 3001) {
	const server = createManagementServer(port);

	const tryListen = (currentPort: number) => {
		server.listen(currentPort, () => {
			console.log(`🚀 Management server running on port ${currentPort}`);
			console.log(`   Health check: http://localhost:${currentPort}/health`);
			console.log(`   Ready check: http://localhost:${currentPort}/ready`);
			console.log(`   Migration status: http://localhost:${currentPort}/admin/migration-status`);
			console.log(`   Run migrations: http://localhost:${currentPort}/admin/migrate`);
		});

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE' && currentPort === 3001) {
				console.log(`Port ${currentPort} is in use, trying port 3002...`);
				tryListen(3002);
			} else {
				console.error('Management server error:', err);
				throw err;
			}
		});
	};

	tryListen(port);

	// Graceful shutdown
	const shutdown = async () => {
		console.log('Shutting down management server...');
		server.close(() => {
			console.log('Management server closed');
		});
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);

	return server;
}
