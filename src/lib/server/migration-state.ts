import { env } from '$env/dynamic/private';

// Shared migration state
let migrationsComplete = false;
let migrationError: Error | null = null;

export function setMigrationComplete(complete: boolean, error: Error | null = null) {
	migrationsComplete = complete;
	migrationError = error;
}

export function getMigrationState() {
	return {
		migrationsComplete,
		migrationError,
		autoMigrateEnabled: env.AUTO_MIGRATE !== 'false',
		schema: env.MIGRATION_SCHEMA || 'public'
	};
}
