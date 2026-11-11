/** Звернення до API: JSON, cookie сесії, заголовок X-VUDO (захист від CSRF), зрозумілі помилки. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Body = unknown;

/** Викликається при 401 — інтерфейс повертає на екран входу. */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(method: Method, url: string, body?: Body): Promise<T> {
  let res: Response;
  const form = body instanceof FormData;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-VUDO': '1',
        ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
      },
      body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Немає з’єднання з сервером. Перевірте інтернет і спробуйте ще раз.');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    // Запити /auth/* самі обробляють 401 (перевірка сесії, вхід) — інакше вийде нескінченний цикл.
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Помилка сервера (${res.status}). Спробуйте ще раз.`, data?.field);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  /** Завантаження файлів (multipart). */
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Сталася помилка. Спробуйте ще раз.');
