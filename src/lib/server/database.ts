import { config } from 'dotenv';
config();

import { Pool, type PoolConfig } from 'pg';

// Database configuration with environment variable support
const dbConfig: PoolConfig = {
	// Use connection string if provided, otherwise use individual parameters
	connectionString: process.env.DATABASE_URL,

	// Individual connection parameters (used if connectionString is not provided)
	host: process.env.PGHOST || 'localhost',
	port: parseInt(process.env.PGPORT || '5432'),
	database: process.env.PGDATABASE || process.env.USER || 'postgres',
	user: process.env.PGUSER || process.env.USER || 'postgres',
	password: process.env.PGPASSWORD,

	// Connection pool configuration
	max: 20, // Maximum number of clients in the pool
	idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
	connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
	maxLifetimeSeconds: 60, // Close connections after 60 seconds regardless of activity

	// SSL configuration - adjust based on your environment
	ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Create a singleton pool instance
const pool = new Pool(dbConfig);

// Pool event handlers for monitoring and debugging
pool.on('connect', () => {
	console.log('New client connected to database');
});

pool.on('acquire', () => {
	console.log('Client acquired from pool');
});

pool.on('error', (err) => {
	console.error('Unexpected error on idle client', err);
});

pool.on('release', (err) => {
	if (err) {
		console.error('Error releasing client back to pool', err);
	}
});

pool.on('remove', () => {
	console.log('Client removed from pool');
});

// Query helper function
export const query = async (text: string, params?: unknown[]) => {
	const start = Date.now();
	try {
		const res = await pool.query(text, params);
		const duration = Date.now() - start;
		console.log('Executed query', { text, duration, rows: res.rowCount });
		return res;
	} catch (error) {
		console.error('Database query error:', error);
		throw error;
	}
};

// Get a client from the pool for transactions
export const getClient = async () => {
	return await pool.connect();
};

// Validate database connection
export const validateConnection = async (): Promise<boolean> => {
	try {
		const result = await query('SELECT 1 as connected');
		return result.rows[0].connected === 1;
	} catch (error) {
		console.error('Database connection validation failed:', error);
		return false;
	}
};

// Gracefully close the pool
export const closePool = async () => {
	await pool.end();
	console.log('Database connection pool closed');
};

// Export the pool instance for direct access if needed
export { pool };

// Export types for use in other modules
export type { PoolConfig, Pool, Client, PoolClient, QueryResult } from 'pg';
