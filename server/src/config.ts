import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL не задано'),
  /** Cookie лише по HTTPS. За замовчуванням увімкнено в production. */
  COOKIE_SECURE: bool.optional(),
  /** Кількість проксі перед сервером (nginx тощо) — для правильного IP клієнта. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** Скільки днів живе сесія без активності. */
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  /** Папка для файлів замовлень (відносно кореня проєкту або абсолютний шлях). */
  UPLOAD_DIR: z.string().default('uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Помилка конфігурації (.env):', z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
  sessionDays: env.SESSION_DAYS,
  uploadDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', env.UPLOAD_DIR),
  logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
} as const;
