import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { validateConnection, pool } from '$lib/server/database';
import { startManagementServer } from '$lib/server/management';
import { migrateWithLock } from '$lib/server/migrate';
import { db } from '$lib/server/db';
import { setMigrationComplete, getMigrationState } from '$lib/server/migration-state';
import { attestationWorker } from '$lib/server/cctp/attestation-worker';
import { loadChainConfig } from '$lib/server/app-config.js';

// Validate database connection on server startup
let connectionValidated = false;
let connectionAttempts = 0;
const maxConnectionAttempts = 5;
const connectionRetryDelay = 2000; // 2 seconds

// Configuration
const AUTO_MIGRATE = env.AUTO_MIGRATE !== 'false'; // default true
const MIGRATION_SCHEMA = env.MIGRATION_SCHEMA || 'public';

// CORS Configuration
const CORS_ALLOWED_ORIGINS =
	env.CORS_ALLOWED_ORIGINS?.split(',').map((origin: string) => origin.trim()) || [];

async function ensureDatabaseConnection(): Promise<void> {
	if (connectionValidated) {
		return;
	}

	while (connectionAttempts < maxConnectionAttempts) {
		connectionAttempts++;

		try {
			console.log(
				`Attempting database connection (attempt ${connectionAttempts}/${maxConnectionAttempts})`
			);

			const isConnected = await validateConnection();

			if (isConnected) {
				console.log('✅ Database connection validated successfully');
				connectionValidated = true;

				// Run migrations if AUTO_MIGRATE is enabled
				const migrationState = getMigrationState();
				if (AUTO_MIGRATE && !migrationState.migrationsComplete) {
					console.log('🔄 Running database migrations...');
					try {
						const migrationResult = await migrateWithLock(db, {
							schema: MIGRATION_SCHEMA,
							lockTimeout: parseInt(env.MIGRATION_LOCK_TIMEOUT || '30000')
						});

						if (migrationResult.success) {
							setMigrationComplete(true);
							if (migrationResult.migrationsRun && migrationResult.migrationsRun > 0) {
								console.log(`✅ Successfully applied ${migrationResult.migrationsRun} migrations`);
							} else {
								console.log('✅ No pending migrations');
							}
							await loadChainConfig();
							attestationWorker.start().catch((error) => {
								console.error('Failed to start attestation worker:', error);
							});
						} else {
							const error = migrationResult.error || new Error('Unknown migration error');
							setMigrationComplete(false, error);
							console.error('❌ Migration failed:', error.message);
						}
					} catch (error) {
						setMigrationComplete(false, error as Error);
						console.error('❌ Migration error:', error);
					}
				} else if (!AUTO_MIGRATE) {
					console.log('ℹ️  Auto-migration disabled (AUTO_MIGRATE=false)');
					setMigrationComplete(true);
					await loadChainConfig();
					attestationWorker.start().catch((error) => {
						console.error('Failed to start attestation worker:', error);
					});
				}

				return;
			} else {
				throw new Error('Connection validation failed');
			}
		} catch (error) {
			console.error(`❌ Database connection attempt ${connectionAttempts} failed:`, error);

			if (connectionAttempts >= maxConnectionAttempts) {
				console.error(
					'🚨 Max database connection attempts reached. Server will continue but database functionality may be limited.'
				);
				break;
			}

			// Wait before retrying
			await new Promise((resolve) => setTimeout(resolve, connectionRetryDelay));
		}
	}
}

// Initialize database connection
ensureDatabaseConnection().catch((error) => {
	console.error('Failed to initialize database connection:', error);
});

// Start management server
const managementPort = parseInt(env.MANAGEMENT_PORT || '3001');
startManagementServer(managementPort);

// Helper function to check if origin matches allowed patterns
function isOriginAllowed(origin: string | null): boolean {
	if (!origin || CORS_ALLOWED_ORIGINS.length === 0) {
		return false;
	}

	return CORS_ALLOWED_ORIGINS.some((pattern: string) => {
		// Handle localhost with any port
		if (
			pattern === 'localhost' ||
			pattern === 'http://localhost' ||
			pattern === 'https://localhost'
		) {
			const localhostRegex = /^https?:\/\/localhost(:\d+)?$/;
			return localhostRegex.test(origin);
		}
		// Handle wildcard subdomain matching
		if (pattern.startsWith('*.')) {
			const domain = pattern.slice(2);
			return (
				origin.endsWith(domain) || origin === `https://${domain}` || origin === `http://${domain}`
			);
		}
		// Exact match
		return origin === `https://${pattern}` || origin === `http://${pattern}` || origin === pattern;
	});
}

// Handle server requests
export const handle: Handle = async ({ event, resolve }) => {
	// Make database connection available in locals
	const migrationState = getMigrationState();
	event.locals.db = {
		pool,
		isConnected: connectionValidated,
		migrationsComplete: migrationState.migrationsComplete,
		migrationError: migrationState.migrationError
	};

	// Handle CORS
	const origin = event.request.headers.get('origin');

	// Handle preflight requests
	if (event.request.method === 'OPTIONS') {
		if (isOriginAllowed(origin)) {
			return new Response(null, {
				status: 200,
				headers: {
					'Access-Control-Allow-Origin': origin!,
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization',
					'Access-Control-Allow-Credentials': 'true',
					'Access-Control-Max-Age': '86400'
				}
			});
		}
		// Return 200 for OPTIONS even if origin not allowed
		return new Response(null, { status: 200 });
	}

	// Add database connection status to response headers (for debugging)
	const response = await resolve(event);

	if (env.NODE_ENV === 'development') {
		response.headers.set('x-db-connected', connectionValidated ? 'true' : 'false');
	}

	// Add CORS headers for allowed origins
	if (isOriginAllowed(origin)) {
		response.headers.set('Access-Control-Allow-Origin', origin!);
		response.headers.set('Access-Control-Allow-Credentials', 'true');
	}

	return response;
};

// Graceful shutdown handling
process.on('SIGINT', async () => {
	console.log('Received SIGINT, shutting down...');
	await attestationWorker.stop();
	try {
		await pool.end();
		console.log('Database connections closed');
	} catch (error) {
		console.error('Error closing database connections:', error);
	}
	process.exit(0);
});

process.on('SIGTERM', async () => {
	console.log('Received SIGTERM, shutting down...');
	await attestationWorker.stop();
	try {
		await pool.end();
		console.log('Database connections closed');
	} catch (error) {
		console.error('Error closing database connections:', error);
	}
	process.exit(0);
});
