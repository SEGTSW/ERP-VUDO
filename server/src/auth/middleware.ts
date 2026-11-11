import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { canSee, isOffice, isOwner, type Section } from '@vudo/shared';
import { pool } from '../db.js';
import { HttpError, forbidden } from '../errors.js';
import type { User } from '../users.js';
import { COOKIE, clearSessionCookie, resolveSession } from './sessions.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    sessionToken?: string;
  }
}

/** Користувач запиту (після requireAuth він завжди є). */
export function me(req: Request): User {
  if (!req.user) throw new HttpError(401, 'Увійдіть у систему.');
  return req.user;
}

/** Підтягує користувача з сесії; без сесії — 401. */
export const requireAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE] as string | undefined;
  const user = token ? await resolveSession(pool, token) : null;
  if (!user) {
    if (token) clearSessionCookie(res);
    throw new HttpError(401, 'Сесія завершилась. Увійдіть знову.');
  }
  req.user = user;
  req.sessionToken = token;
  next();
};

/** Менеджер або власник. */
export const requireOffice: RequestHandler = (req, _res, next) => {
  if (!isOffice(me(req))) throw forbidden();
  next();
};

/** Лише власник (роль Адмін) — фінансова звітність. */
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (!isOwner(me(req))) throw forbidden('Доступно лише власнику.');
  next();
};

/** Розділ меню має бути доступний ролі — навіть за прямим посиланням. */
export const requireSection =
  (s: Section): RequestHandler =>
  (req, _res, next) => {
    if (!canSee(me(req), s)) throw forbidden();
    next();
  };

/**
 * Захист від CSRF: змінювальні запити мають містити заголовок X-VUDO.
 * Браузер не надішле власний заголовок з чужого сайту без CORS, а CORS вимкнено.
 */
export const requireAppHeader: RequestHandler = (req, _res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-vudo') !== '1') {
    throw new HttpError(403, 'Запит відхилено. Оновіть сторінку.');
  }
  next();
};
