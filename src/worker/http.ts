import type { ApiError, ApiErrorCode } from '../shared/protocol';

const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  new Headers(headers).forEach((v, k) => h.append(k, v));
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function error(status: number, code: ApiErrorCode, message: string, headers: HeadersInit = {}): Response {
  const body: ApiError = { error: code, message };
  return json(body, status, headers);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 4096;

/** Czyta JSON z limitem rozmiaru. */
export async function readJson<T>(request: Request): Promise<T> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Zbyt duże żądanie.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Zbyt duże żądanie.');
  try {
    return JSON.parse(text || '{}') as T;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Nieprawidłowy JSON.');
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Ciasteczko sesji: Secure + HttpOnly, prefiks __Host- (bez Domain, Path=/). */
export function sessionCookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
