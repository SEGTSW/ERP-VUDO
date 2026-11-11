import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

/** Помилка з HTTP-кодом і текстом для користувача (що саме зробити). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, field?: string) => new HttpError(400, msg, field);
export const forbidden = (msg = 'Недостатньо прав для цієї дії.') => new HttpError(403, msg);
export const notFound = (msg = 'Не знайдено.') => new HttpError(404, msg);

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, field: err.field });
    return;
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    res.status(400).json({ error: issue?.message ?? 'Неправильні дані.', field: issue?.path.join('.') || undefined });
    return;
  }
  // Некоректний JSON у тілі запиту
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Неправильний формат запиту.' });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'Запит завеликий.' });
    return;
  }
  logger.error({ err, method: req.method, url: req.originalUrl }, 'Необроблена помилка');
  res.status(500).json({ error: 'Внутрішня помилка сервера. Спробуйте ще раз або зверніться до адміністратора.' });
};
