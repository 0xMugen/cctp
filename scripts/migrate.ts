#!/usr/bin/env node
import { config } from 'dotenv';
config();

import { migrate, rollback, status, recreate } from '../src/lib/server/migrate.js';
import { db } from '../src/lib/server/db.js';
import { saveSchema } from '../src/lib/server/schema.js';
import path from 'path';

const command = process.argv[2];
const arg = process.argv[3];

async function main() {
	try {
		switch (command) {
			case 'up':
				await migrate(db);
				break;

			case 'down': {
				const steps = arg ? parseInt(arg) : 1;
				await rollback(db, steps);
				break;
			}

			case 'status':
				await status(db);
				break;

			case 'dry-run':
				await migrate(db, { dryRun: true });
				break;

			case 'recreate':
				await recreate(db);
				break;

			case 'generate-schema': {
				const outputPath = arg || path.join(process.cwd(), 'schema.sql');
				await saveSchema(db, outputPath);
				break;
			}

			default:
				console.log('Usage: npm run migrate [command] [options]');
				console.log('Commands:');
				console.log('  up                 - Apply all pending migrations');
				console.log('  down [steps]       - Rollback migrations (default: 1 step)');
				console.log('  status             - Show migration status');
				console.log('  dry-run            - Show what migrations would be applied');
				console.log('  recreate           - Drop and recreate schema with all migrations');
				console.log('  generate-schema    - Generate schema.sql from current database');
				process.exit(1);
		}
	} catch (error) {
		console.error('Migration error:', error);
		process.exit(1);
	} finally {
		await db.close();
	}
}

main();
