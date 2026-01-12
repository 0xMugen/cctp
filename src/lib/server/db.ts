import { pool } from './database.js';
import type { Pool } from 'pg';

export type Db = {
	execute<T>(query: string, params?: unknown[]): Promise<T[]>;
	batch<T>(queries: { query: string; params: unknown[] }[]): Promise<T[]>;
	close(): Promise<void>;
};

export function createDb(poolInstance: Pool): Db {
	return {
		async execute<T>(query: string, params: unknown[] = []): Promise<T[]> {
			const result = await poolInstance.query(query, params);
			return result.rows as T[];
		},

		async batch<T>(queries: { query: string; params: unknown[] }[]): Promise<T[]> {
			const client = await poolInstance.connect();
			try {
				await client.query('BEGIN');
				const results = [];
				for (const { query, params } of queries) {
					const result = await client.query(query, params);
					results.push(result.rows);
				}
				await client.query('COMMIT');
				return results as T[];
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			} finally {
				client.release();
			}
		},

		async close(): Promise<void> {
			await poolInstance.end();
		}
	};
}

export const db = createDb(pool);
