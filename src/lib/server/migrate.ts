import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import type { Db } from './db.js';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');
const MIGRATION_LOCK_KEY = 12345; // Fixed advisory lock key for migrations
const DEFAULT_LOCK_TIMEOUT = parseInt(process.env.MIGRATION_LOCK_TIMEOUT || '30000'); // 30 seconds

export interface MigrationRecord {
	id: number;
	filename: string;
	applied_at: string;
	checksum: string;
}

export interface MigrationLock {
	id: number;
	lock_key: string;
	locked_by: string;
	locked_at: string;
	expires_at: string;
	process_id: number | null;
	host_name: string | null;
	released: boolean;
	released_at: string | null;
}

export interface MigrationOptions {
	dryRun?: boolean;
	schema?: string;
	skipLock?: boolean;
	lockTimeout?: number;
}

export async function createMigrationsTable(db: Db, schema = 'public'): Promise<void> {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS ${schema}.migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      checksum VARCHAR(64) NOT NULL
    )
  `);
}

export async function acquireMigrationLock(
	db: Db,
	lockKey = 'migrations',
	timeoutMs = DEFAULT_LOCK_TIMEOUT
): Promise<boolean> {
	const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	const hostname = os.hostname();
	const expiresAt = new Date(Date.now() + timeoutMs);

	console.log(`Attempting to acquire migration lock (timeout: ${timeoutMs}ms)...`);

	try {
		// First clean up any expired locks for this key
		await db.execute(
			`UPDATE migration_locks
			 SET released = TRUE, released_at = NOW()
			 WHERE lock_key = $1 AND released = FALSE AND expires_at < NOW()`,
			[lockKey]
		);

		// Try to acquire PostgreSQL advisory lock (non-blocking)
		const advisoryResult = await db.execute<{ pg_try_advisory_lock: boolean }>(
			'SELECT pg_try_advisory_lock($1) as pg_try_advisory_lock',
			[MIGRATION_LOCK_KEY]
		);

		if (!advisoryResult[0]?.pg_try_advisory_lock) {
			console.log('Another process holds the advisory lock, waiting...');

			// Wait for lock with timeout
			const startTime = Date.now();
			while (Date.now() - startTime < timeoutMs) {
				// Clean up expired locks on each retry
				await db.execute(
					`UPDATE migration_locks
					 SET released = TRUE, released_at = NOW()
					 WHERE lock_key = $1 AND released = FALSE AND expires_at < NOW()`,
					[lockKey]
				);

				const retryResult = await db.execute<{ pg_try_advisory_lock: boolean }>(
					'SELECT pg_try_advisory_lock($1) as pg_try_advisory_lock',
					[MIGRATION_LOCK_KEY]
				);

				if (retryResult[0]?.pg_try_advisory_lock) {
					break;
				}

				// Wait 1 second before retrying
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			// Final check if we got the lock
			const finalResult = await db.execute<{ pg_try_advisory_lock: boolean }>(
				'SELECT pg_try_advisory_lock($1) as pg_try_advisory_lock',
				[MIGRATION_LOCK_KEY]
			);

			if (!finalResult[0]?.pg_try_advisory_lock) {
				console.error('Failed to acquire advisory lock within timeout');
				return false;
			}
		}

		// Record lock acquisition in migration_locks table
		// Use INSERT ... ON CONFLICT to handle duplicate keys gracefully
		await db.execute(
			`INSERT INTO migration_locks (lock_key, locked_by, expires_at, process_id, host_name)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (lock_key)
			 DO UPDATE SET
			   locked_by = EXCLUDED.locked_by,
			   locked_at = CURRENT_TIMESTAMP,
			   expires_at = EXCLUDED.expires_at,
			   process_id = EXCLUDED.process_id,
			   host_name = EXCLUDED.host_name,
			   released = FALSE,
			   released_at = NULL`,
			[lockKey, lockId, expiresAt, process.pid, hostname]
		);

		console.log(`Migration lock acquired by ${lockId} on ${hostname}`);
		return true;
	} catch (error) {
		console.error('Error acquiring migration lock:', error);
		// Try to release advisory lock if we got it but failed to record
		try {
			await db.execute('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
		} catch {
			// Ignore errors during cleanup
		}
		return false;
	}
}

export async function releaseMigrationLock(db: Db, lockKey = 'migrations'): Promise<void> {
	try {
		// Release PostgreSQL advisory lock
		await db.execute('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);

		// Mark lock as released in the table
		await db.execute(
			`UPDATE migration_locks
			 SET released = TRUE, released_at = NOW()
			 WHERE lock_key = $1 AND process_id = $2 AND released = FALSE`,
			[lockKey, process.pid]
		);

		console.log('Migration lock released successfully');
	} catch (error) {
		console.error('Error releasing migration lock:', error);
		throw error;
	}
}

export function calculateChecksum(content: string): string {
	return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Split SQL content into individual statements, respecting dollar-quoted strings.
 * Dollar quotes ($$...$$) can contain semicolons that should not be treated as statement terminators.
 */
export function splitSqlStatements(content: string): string[] {
	const statements: string[] = [];
	let currentStatement = '';
	let inDollarQuote = false;
	let dollarTag = '';
	let i = 0;

	while (i < content.length) {
		const char = content[i];

		if (char === '$') {
			let tagEnd = i + 1;
			while (
				tagEnd < content.length &&
				content[tagEnd] !== '$' &&
				/[a-zA-Z0-9_]/.test(content[tagEnd])
			) {
				tagEnd++;
			}

			if (tagEnd < content.length && content[tagEnd] === '$') {
				const tag = content.slice(i, tagEnd + 1); // e.g., "$$" or "$tag$"

				if (!inDollarQuote) {
					inDollarQuote = true;
					dollarTag = tag;
					currentStatement += tag;
					i = tagEnd + 1;
					continue;
				} else if (tag === dollarTag) {
					inDollarQuote = false;
					currentStatement += tag;
					dollarTag = '';
					i = tagEnd + 1;
					continue;
				}
			}
		}

		if (char === ';' && !inDollarQuote) {
			currentStatement += char;
			const trimmed = currentStatement.trim();
			if (trimmed.length > 0 && trimmed !== ';') {
				statements.push(trimmed);
			}
			currentStatement = '';
			i++;
			continue;
		}

		currentStatement += char;
		i++;
	}

	const trimmed = currentStatement.trim();
	if (trimmed.length > 0 && trimmed !== ';') {
		statements.push(trimmed);
	}

	return statements;
}

export async function getAppliedMigrations(db: Db, schema = 'public'): Promise<MigrationRecord[]> {
	return await db.execute<MigrationRecord>(
		`SELECT * FROM ${schema}.migrations ORDER BY filename`,
		[]
	);
}

export function getMigrationFiles(): string[] {
	if (!fs.existsSync(MIGRATIONS_DIR)) {
		return [];
	}

	return fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((file) => file.endsWith('.sql'))
		.sort();
}

export async function applyMigration(db: Db, filename: string, schema = 'public'): Promise<void> {
	const filePath = path.join(MIGRATIONS_DIR, filename);
	const content = fs.readFileSync(filePath, 'utf8');
	const checksum = calculateChecksum(content);

	console.log(`Applying migration: ${filename} to schema: ${schema}`);

	// If not public schema, set search_path before running migration
	if (schema !== 'public') {
		await db.execute(`SET search_path TO ${schema}`, []);
	}

	const statements = splitSqlStatements(content);

	for (const statement of statements) {
		if (statement.trim()) {
			await db.execute(statement, []);
		}
	}

	// Reset search_path if needed
	if (schema !== 'public') {
		await db.execute(`SET search_path TO public`, []);
	}

	await db.execute(`INSERT INTO ${schema}.migrations (filename, checksum) VALUES ($1, $2)`, [
		filename,
		checksum
	]);

	console.log(`Migration applied successfully: ${filename}`);
}

export async function validateMigration(
	db: Db,
	filename: string,
	schema = 'public'
): Promise<boolean> {
	const filePath = path.join(MIGRATIONS_DIR, filename);
	const content = fs.readFileSync(filePath, 'utf8');
	const currentChecksum = calculateChecksum(content);

	const records = await db.execute<MigrationRecord>(
		`SELECT checksum FROM ${schema}.migrations WHERE filename = $1`,
		[filename]
	);

	if (records.length === 0) {
		return true;
	}

	const storedChecksum = records[0].checksum;
	if (currentChecksum !== storedChecksum) {
		throw new Error(
			`Migration ${filename} has been modified after being applied. Expected checksum: ${storedChecksum}, got: ${currentChecksum}`
		);
	}

	return true;
}

export async function migrate(db: Db, options: MigrationOptions = {}): Promise<void> {
	const { dryRun = false, schema = 'public' } = options;

	await createMigrationsTable(db, schema);

	const appliedMigrations = await getAppliedMigrations(db, schema);
	const appliedSet = new Set(appliedMigrations.map((m) => m.filename));

	const migrationFiles = getMigrationFiles();

	// Validate all applied migrations first
	for (const file of migrationFiles) {
		if (appliedSet.has(file)) {
			await validateMigration(db, file, schema);
		}
	}

	const pendingMigrations = migrationFiles.filter((file) => !appliedSet.has(file));

	if (pendingMigrations.length === 0) {
		console.log('No pending migrations found.');
		return;
	}

	console.log(`Found ${pendingMigrations.length} pending migrations for schema ${schema}:`);
	for (const migration of pendingMigrations) {
		console.log(`  - ${migration}`);
	}

	if (dryRun) {
		console.log('Dry run mode - no migrations will be applied.');
		return;
	}

	for (const migration of pendingMigrations) {
		await applyMigration(db, migration, schema);
	}

	console.log('All migrations applied successfully.');
}

export async function migrateWithLock(
	db: Db,
	options: MigrationOptions = {}
): Promise<{ success: boolean; error?: Error; migrationsRun?: number }> {
	const { skipLock = false, lockTimeout = DEFAULT_LOCK_TIMEOUT, schema = 'public' } = options;

	// If skipLock is true, just run migrations without locking
	if (skipLock) {
		try {
			await migrate(db, options);
			return { success: true };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	let lockAcquired = false;

	try {
		// First ensure the migration table exists
		await createMigrationsTable(db, schema);

		// Ensure migration_locks table exists (created by code, not migration)
		try {
			await db.execute(`
				CREATE TABLE IF NOT EXISTS migration_locks (
					id SERIAL PRIMARY KEY,
					lock_key VARCHAR(50) NOT NULL UNIQUE,
					locked_by VARCHAR(255) NOT NULL,
					locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					expires_at TIMESTAMP NOT NULL,
					process_id INTEGER,
					host_name VARCHAR(255),
					released BOOLEAN DEFAULT FALSE,
					released_at TIMESTAMP,
					CONSTRAINT valid_lock_duration CHECK (expires_at > locked_at)
				)
			`);

			// Create indexes only if table was just created
			const indexExists = await db.execute<{ exists: boolean }>(
				`SELECT EXISTS (
					SELECT FROM pg_class c
					JOIN pg_namespace n ON n.oid = c.relnamespace
					WHERE n.nspname = $1 AND c.relname = 'idx_migration_locks_active'
				) as exists`,
				[schema]
			);

			if (!indexExists[0]?.exists) {
				await db.execute(`
					CREATE INDEX idx_migration_locks_active
					ON migration_locks(lock_key, released, expires_at)
					WHERE released = FALSE
				`);

				await db.execute(`
					CREATE INDEX idx_migration_locks_history
					ON migration_locks(locked_at DESC)
				`);
			}
		} catch (error) {
			console.error('Error ensuring migration_locks table exists:', error);
			// Continue anyway - the table might exist or we might not have permissions
		}

		// Acquire the migration lock
		lockAcquired = await acquireMigrationLock(db, `migrations:${schema}`, lockTimeout);

		if (!lockAcquired) {
			console.error('Could not acquire migration lock within timeout');
			return {
				success: false,
				error: new Error(`Failed to acquire migration lock within ${lockTimeout}ms timeout`)
			};
		}

		// Check for pending migrations before running
		const appliedMigrations = await getAppliedMigrations(db, schema);
		const appliedSet = new Set(appliedMigrations.map((m) => m.filename));
		const migrationFiles = getMigrationFiles();
		const pendingCount = migrationFiles.filter((file) => !appliedSet.has(file)).length;

		// Run migrations
		await migrate(db, options);

		return { success: true, migrationsRun: pendingCount };
	} catch (error) {
		console.error('Migration error:', error);
		return { success: false, error: error as Error };
	} finally {
		// Always release the lock if we acquired it
		if (lockAcquired) {
			try {
				await releaseMigrationLock(db, `migrations:${schema}`);
			} catch (error) {
				console.error('Error releasing migration lock:', error);
			}
		}
	}
}

export async function getMigrationStatus(
	db: Db,
	schema = 'public'
): Promise<{ pending: string[]; applied: string[]; locked: boolean }> {
	try {
		await createMigrationsTable(db, schema);

		const appliedMigrations = await getAppliedMigrations(db, schema);
		const appliedSet = new Set(appliedMigrations.map((m) => m.filename));
		const migrationFiles = getMigrationFiles();

		const pending = migrationFiles.filter((file) => !appliedSet.has(file));
		const applied = migrationFiles.filter((file) => appliedSet.has(file));

		// Check if migrations are currently locked
		let locked = false;
		try {
			const lockStatus = await db.execute<{ pg_try_advisory_lock: boolean }>(
				'SELECT pg_try_advisory_lock($1) as pg_try_advisory_lock',
				[MIGRATION_LOCK_KEY]
			);

			if (lockStatus[0]?.pg_try_advisory_lock) {
				// We got the lock, so it wasn't locked
				await db.execute('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
				locked = false;
			} else {
				// We couldn't get the lock, so it's locked
				locked = true;
			}
		} catch {
			// Assume not locked if we can't check
			locked = false;
		}

		return { pending, applied, locked };
	} catch (error) {
		console.error('Error getting migration status:', error);
		return { pending: [], applied: [], locked: false };
	}
}

export async function rollback(db: Db, steps: number = 1, schema = 'public'): Promise<void> {
	const appliedMigrations = await getAppliedMigrations(db, schema);

	if (appliedMigrations.length === 0) {
		console.log('No migrations to rollback.');
		return;
	}

	const migrationsToRollback = appliedMigrations.reverse().slice(0, steps);

	for (const migration of migrationsToRollback) {
		const rollbackPath = path.join(
			MIGRATIONS_DIR,
			migration.filename.replace('.sql', '.rollback.sql')
		);

		if (!fs.existsSync(rollbackPath)) {
			console.warn(`No rollback file found for ${migration.filename}, skipping.`);
			continue;
		}

		// If not public schema, set search_path before running rollback
		if (schema !== 'public') {
			await db.execute(`SET search_path TO ${schema}`, []);
		}

		const rollbackContent = fs.readFileSync(rollbackPath, 'utf8');
		// Use the dollar-quote-aware splitter instead of naive split(';')
		const statements = splitSqlStatements(rollbackContent);

		console.log(`Rolling back migration: ${migration.filename}`);

		for (const statement of statements) {
			if (statement.trim()) {
				await db.execute(statement, []);
			}
		}

		// Reset search_path if needed
		if (schema !== 'public') {
			await db.execute(`SET search_path TO public`, []);
		}

		await db.execute(`DELETE FROM ${schema}.migrations WHERE filename = $1`, [migration.filename]);

		console.log(`Migration rolled back successfully: ${migration.filename}`);
	}
}

export async function status(db: Db, schema = 'public'): Promise<void> {
	await createMigrationsTable(db, schema);

	const appliedMigrations = await getAppliedMigrations(db, schema);
	const appliedSet = new Set(appliedMigrations.map((m) => m.filename));

	const migrationFiles = getMigrationFiles();

	if (migrationFiles.length === 0) {
		console.log('No migration files found.');
		return;
	}

	console.log(`Migration Status (schema: ${schema}):`);
	console.log('================');

	for (const file of migrationFiles) {
		if (appliedSet.has(file)) {
			try {
				await validateMigration(db, file, schema);
				const appliedRecord = appliedMigrations.find((m) => m.filename === file);
				const appliedAt = appliedRecord ? ` (${appliedRecord.applied_at})` : '';
				console.log(`✓ Applied ${file}${appliedAt}`);
			} catch (error) {
				console.log(
					`⚠ Modified ${file} - ${error instanceof Error ? error.message : 'Unknown error'}`
				);
			}
		} else {
			console.log(`✗ Pending ${file}`);
		}
	}

	const pendingCount = migrationFiles.filter((file) => !appliedSet.has(file)).length;
	console.log(`\nSummary: ${appliedMigrations.length} applied, ${pendingCount} pending`);
}

export async function recreate(db: Db, schema = 'public'): Promise<void> {
	console.log(`Recreating schema: ${schema}`);

	if (schema === 'public') {
		console.log('Dropping public schema and recreating it...');
		await db.execute(`DROP SCHEMA public CASCADE`, []);
		await db.execute(`CREATE SCHEMA public`, []);
		await db.execute(`GRANT ALL ON SCHEMA public TO public`, []);
		await db.execute(`GRANT ALL ON SCHEMA public TO ${process.env.PGUSER || 'postgres'}`, []);
	} else {
		console.log(`Dropping schema ${schema} and recreating it...`);
		await db.execute(`DROP SCHEMA IF EXISTS ${schema} CASCADE`, []);
		await db.execute(`CREATE SCHEMA ${schema}`, []);
	}

	console.log(`Schema ${schema} recreated successfully`);

	console.log('Applying all migrations...');
	await migrate(db, { schema });

	console.log(`Schema ${schema} recreated and all migrations applied successfully`);
}
