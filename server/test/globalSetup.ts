import pg from 'pg';

/** Перед усіма тестами: чиста схема тестової БД і всі міграції. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/vudo_erp_test';
  if (!/test/.test(url)) throw new Error(`Тести запускаються лише на тестовій БД (у назві має бути "test"): ${url}`);
  process.env.DATABASE_URL = url;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  const pool = new pg.Pool({ connectionString: url });
  const { migrate } = await import('../src/migrate.js');
  await migrate(pool);
  await pool.end();
}
