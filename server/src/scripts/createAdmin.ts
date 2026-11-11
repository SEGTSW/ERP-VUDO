/**
 * Перший запуск робочої системи: створює власника (роль Адмін).
 *   npm run create-admin -- --login owner --name "Ім'я Прізвище"
 * Пароль запитується в терміналі (не потрапляє в історію команд).
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { LOGIN_RE, PASSWORD_MIN, normalizeLogin } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { migrate } from '../migrate.js';
import { hashPassword } from '../auth/password.js';
import { writeLog } from '../audit.js';

const { values } = parseArgs({ options: { login: { type: 'string' }, name: { type: 'string' } } });

async function ask(q: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(q)) out.output.write(s);
    };
  }
  const a = await rl.question(q);
  if (hidden) process.stdout.write('\n');
  rl.close();
  return a;
}

await migrate(pool, (m) => console.log(m));
const login = normalizeLogin(values.login ?? (await ask('Логін: ')));
if (!LOGIN_RE.test(login)) throw new Error('Логін: щонайменше 3 символи, латиниця, цифри, крапка, дефіс.');
const name = (values.name ?? (await ask("Ім'я та прізвище: "))).trim();
if (!name) throw new Error("Вкажіть ім'я.");
const pass = await ask(`Пароль (щонайменше ${PASSWORD_MIN} символів): `, true);
if (pass.length < PASSWORD_MIN) throw new Error(`Пароль: щонайменше ${PASSWORD_MIN} символів.`);
if ((await ask('Ще раз: ', true)) !== pass) throw new Error('Паролі не збігаються.');

await tx(async (c) => {
  const r = await c.query<{ id: number }>(
    `INSERT INTO users (name, login, password_hash, roles) VALUES ($1, $2, $3, ARRAY['Адмін']) RETURNING id`,
    [name, login, await hashPassword(pass)],
  );
  await writeLog(c, { userId: r.rows[0]!.id, folder: 'other', text: `Новий користувач «${name}», ролі: Адмін` });
});
console.log(`Власника «${name}» створено. Логін: ${login}`);
await pool.end();
