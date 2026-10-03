/**
 * Sesje.
 *
 * Mieszkaniec: ciasteczko `__Host-winda_sid` = budynek.instalacja.sekret.
 * Worker kieruje żądanie do Durable Objectu budynku z ciasteczka, a obiekt
 * sprawdza skrót sekretu i to, czy dostęp nie został cofnięty. Identyfikator
 * budynku w treści żądania jest ignorowany, więc instalacja nie wezwie windy
 * w innym budynku.
 *
 * Administrator: ciasteczko `__Host-winda_admin` = wygaśnięcie.podpis HMAC
 * kluczem ADMIN_PASSWORD (bezstanowe, ważne 12 h).
 */
import { BUILDINGS } from '../shared/config';
import { parseCookies } from './http';
import { hmac, safeEqual } from './security';

export const SESSION_COOKIE = '__Host-winda_sid';
export const ADMIN_COOKIE = '__Host-winda_admin';
export const SESSION_MAX_AGE_SEC = 400 * 24 * 3600;
export const ADMIN_MAX_AGE_SEC = 12 * 3600;

export interface SessionRef {
  buildingId: string;
  installationId: string;
  secret: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeSession(s: SessionRef): string {
  return `${s.buildingId}.${s.installationId}.${s.secret}`;
}

export function readSession(request: Request): SessionRef | null {
  const raw = parseCookies(request)[SESSION_COOKIE];
  if (!raw) return null;
  const [buildingId, installationId, secret, ...rest] = raw.split('.');
  if (rest.length || !buildingId || !installationId || !secret) return null;
  if (!ID_RE.test(buildingId) || !ID_RE.test(installationId) || !/^[A-Za-z0-9_-]{20,100}$/.test(secret)) return null;
  if (!BUILDINGS[buildingId]) return null;
  return { buildingId, installationId, secret };
}

export async function createAdminToken(password: string, now: number): Promise<string> {
  const exp = now + ADMIN_MAX_AGE_SEC * 1000;
  return `${exp}.${await hmac(password, `admin.${exp}`)}`;
}

export async function isAdmin(request: Request, password: string | undefined, now: number): Promise<boolean> {
  if (!password) return false;
  const raw = parseCookies(request)[ADMIN_COOKIE];
  if (!raw) return false;
  const [expStr, sig] = raw.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  return safeEqual(sig, await hmac(password, `admin.${exp}`));
}

/** Kod aktywacyjny w QR: budynek.token (token jednorazowy, serwer zna tylko jego skrót). */
export function parseActivationCode(code: unknown): { buildingId: string; token: string } | null {
  if (typeof code !== 'string' || code.length > 120) return null;
  const [buildingId, token, ...rest] = code.split('.');
  if (rest.length || !buildingId || !token || !BUILDINGS[buildingId]) return null;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return { buildingId, token };
}
