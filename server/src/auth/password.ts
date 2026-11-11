import { hash, verify } from '@node-rs/argon2';

// argon2id (алгоритм бібліотеки за замовчуванням) з параметрами за рекомендацією OWASP.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTS);

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Хеш для порівняння, коли логіна не існує — щоб час відповіді не видавав, чи є такий користувач. */
let dummy: Promise<string> | null = null;
export async function burnVerify(plain: string): Promise<void> {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummy, plain);
}
