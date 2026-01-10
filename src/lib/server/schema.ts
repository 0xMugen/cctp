import type { Db } from './db.js';
import { spawn } from 'child_process';
import { getMigrationFiles, createMigrationsTable, applyMigration } from './migrate.js';
import crypto from 'crypto';

export async function saveSchema(db: Db, outputPath: string): Promise<void> {
	const fs = await import('fs/promises');

	// Create a unique schema name for clean generation
	const timestamp = Date.now();
	const randomSuffix = crypto.randomBytes(4).toString('hex');
	const tempSchemaName = `schema_gen_${timestamp}_${randomSuffix}`;

	try {
		// Create temporary schema for clean generation
		await db.execute(`CREATE SCHEMA IF NOT EXISTS ${tempSchemaName}`);
		await db.execute(`SET search_path TO ${tempSchemaName}`);

		// Apply all migrations to the temporary schema
		await createMigrationsTable(db, tempSchemaName);

		const migrationFiles = getMigrationFiles();
		for (const filename of migrationFiles) {
			if (!filename.includes('rollback')) {
				await applyMigration(db, filename, tempSchemaName);
			}
		}

		// Generate schema dump from the clean migrated schema
		const schemaOutput = await generateSchemaDump(tempSchemaName);

		// Normalize the output by replacing the temp schema name with "public"
		const normalizedOutput = schemaOutput.replace(new RegExp(tempSchemaName, 'g'), 'public');

		await fs.writeFile(outputPath, normalizedOutput, 'utf8');
		console.log(`Schema saved to: ${outputPath}`);
	} catch (error) {
		console.error('Error generating schema:', error);
		throw error;
	} finally {
		// Clean up temporary schema
		try {
			await db.execute(`DROP SCHEMA IF EXISTS ${tempSchemaName} CASCADE`);
			await db.execute(`SET search_path TO public`);
		} catch (cleanupError) {
			console.warn(`Failed to cleanup temp schema ${tempSchemaName}:`, cleanupError);
		}
	}
}

export async function generateSchemaDump(
	schemaName: string,
	options?: { verbose?: boolean }
): Promise<string> {
	// Use DATABASE_URL if available, otherwise fall back to individual env vars
	const databaseUrl = process.env.DATABASE_URL;
	let args: string[];

	// Use pg_dump directly since it should be available in CI environment
	const pgDumpCmd = 'pg_dump';

	if (databaseUrl) {
		args = [
			'--schema-only',
			'--no-owner',
			'--no-privileges',
			'--no-comments',
			'--no-security-labels',
			'--no-tablespaces',
			'--no-publications',
			'--no-subscriptions',
			'--exclude-table-data=*',
			`--schema=${schemaName}`,
			databaseUrl
		];
	} else {
		const host = process.env.PGHOST || 'localhost';
		const port = process.env.PGPORT || '5432';
		const database = process.env.PGDATABASE || process.env.USER || 'postgres';
		const user = process.env.PGUSER || process.env.USER || 'postgres';

		args = [
			'--schema-only',
			'--no-owner',
			'--no-privileges',
			'--no-comments',
			'--no-security-labels',
			'--no-tablespaces',
			'--no-publications',
			'--no-subscriptions',
			'--exclude-table-data=*',
			`--schema=${schemaName}`,
			`--host=${host}`,
			`--port=${port}`,
			`--username=${user}`,
			database
		];
	}

	if (options?.verbose) {
		console.log(`Running: ${pgDumpCmd} ${args.join(' ')}`);
	}

	return new Promise((resolve, reject) => {
		const child = spawn(pgDumpCmd, args, {
			env: {
				...process.env,
				// Only set PGPASSWORD if we're not using DATABASE_URL (which includes auth)
				...(databaseUrl ? {} : { PGPASSWORD: process.env.PGPASSWORD || '' })
			}
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr.on('data', (data) => {
			const stderrData = data.toString();
			stderr += stderrData;
			// Stream stderr in real-time if verbose
			if (options?.verbose) {
				process.stderr.write(`pg_dump: ${stderrData}`);
			}
		});

		child.on('close', (code) => {
			if (code === 0) {
				// Filter out SET statements, DROP statements, and comments that can vary between environments
				const filteredOutput = stdout
					.split('\n')
					.filter((line) => {
						const trimmed = line.trim();
						return !(
							trimmed.startsWith('SET statement_timeout') ||
							trimmed.startsWith('SET lock_timeout') ||
							trimmed.startsWith('SET idle_in_transaction_session_timeout') ||
							trimmed.startsWith('SET transaction_timeout') ||
							trimmed.startsWith('SET client_encoding') ||
							trimmed.startsWith('SET standard_conforming_strings') ||
							trimmed.startsWith("SELECT pg_catalog.set_config('search_path'") ||
							trimmed.startsWith('SET check_function_bodies') ||
							trimmed.startsWith('SET xmloption') ||
							trimmed.startsWith('SET client_min_messages') ||
							trimmed.startsWith('SET row_security') ||
							trimmed.startsWith('DROP SCHEMA') ||
							trimmed.startsWith('DROP SEQUENCE') ||
							trimmed.startsWith('DROP TABLE') ||
							trimmed.startsWith('DROP INDEX') ||
							trimmed.startsWith('DROP CONSTRAINT') ||
							trimmed.startsWith('DROP FUNCTION') ||
							trimmed.startsWith('DROP TYPE') ||
							trimmed.startsWith('DROP VIEW') ||
							trimmed.startsWith('--') || // Remove all comments
							trimmed.startsWith('/*') || // Remove block comments
							trimmed.includes('Dumped from database version') ||
							trimmed.includes('Dumped by pg_dump version') ||
							trimmed.includes('PostgreSQL database dump') ||
							trimmed.includes('\\restrict') ||
							trimmed.includes('\\unrestrict')
						);
					})
					.join('\n')
					.replace(/\n{3,}/g, '\n\n') // Replace multiple consecutive newlines with just two
					.trim(); // Remove leading/trailing whitespace

				resolve(filteredOutput);
			} else {
				reject(new Error(`pg_dump exited with code ${code}. stderr: ${stderr}`));
			}
		});

		child.on('error', (error) => {
			reject(error);
		});

		// Add timeout
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error('pg_dump timed out after 5 minutes'));
		}, 300000);

		child.on('close', () => {
			clearTimeout(timeout);
		});
	});
}
