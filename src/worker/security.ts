/**
 * Kryptografia i ochrona przed nadużyciami.
 */
const enc = new TextEncoder();

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(b);
}

export function base64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

/** Porównanie w stałym czasie (dla haseł i podpisów). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Weryfikacja pochodzenia dla żądań zmieniających stan i WebSocketów.
 * Przeglądarka zawsze wysyła Origin przy POST/PATCH/DELETE i przy WebSocket.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const self = new URL(request.url).origin;
  if (origin) return origin === self;
  // Brak Origin: akceptujemy tylko jawnie oznaczone żądania z tej samej strony.
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/** Prosty limiter „kubełek z żetonami” w pamięci obiektu (na instalację). */
export class TokenBuckets {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private capacity: number,
    private refillPerSec: number,
  ) {}

  take(key: string, now: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return true;
  }
}
