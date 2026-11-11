import { pool } from '../db.js';
import { migrate } from '../migrate.js';

const applied = await migrate(pool, (m) => console.log(m));
console.log(applied.length ? `Готово: ${applied.length} міграцій.` : 'База вже актуальна.');
await pool.end();
