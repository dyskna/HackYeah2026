/**
 * Worker: API, WebSocket i pliki frontendu (Workers Static Assets) pod jedną domeną.
 *
 * Każde żądanie zmieniające stan i każde połączenie WebSocket przechodzi
 * weryfikację pochodzenia. Aktywacja i logowanie administratora mają limit
 * żądań per IP, a operacje mieszkańca limit per instalacja (w Durable Objekcie).
 */
import type { SimInput } from '../engine/building';
import type { BuildingConfig } from '../shared/config';
import { BUILDINGS, DEMO_BUILDING } from '../shared/config';
import {
  ADMIN_COOKIE,
  ADMIN_MAX_AGE_SEC,
  createAdminToken,
  encodeSession,
  isAdmin,
  parseActivationCode,
  readSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
} from './auth';
import type { Auth, DoResult, Env } from './building-do';
import { clearCookie, error, HttpError, json, readJson, sessionCookie } from './http';
import { safeEqual, sameOrigin } from './security';

export { BuildingDO } from './building-do';

function stubFor(env: Env, buildingId: string) {
  return env.BUILDING.get(env.BUILDING.idFromName(buildingId));
}

async function building(env: Env, buildingId: string) {
  const stub = stubFor(env, buildingId);
  await stub.init(buildingId);
  return stub;
}

function respond<T>(r: DoResult<T>, headers: HeadersInit = {}): Response {
  return r.ok ? json(r.data, r.status, headers) : error(r.status, r.error, r.message);
}

async function ipLimit(request: Request, env: Env, bucket: string): Promise<void> {
  if (!env.IP_LIMITER) return;
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const { success } = await env.IP_LIMITER.limit({ key: `${bucket}:${ip}` });
  if (!success) throw new HttpError(429, 'rate_limited', 'Zbyt wiele prób. Spróbuj za chwilę.');
}

const SIM_TYPES = ['hall_press', 'car_press', 'enter', 'exit', 'board_group', 'fault', 'config'] as const;
const CONFIG_NUMBERS = ['capacity', 'travelPerFloorMs', 'doorOpenMs', 'doorDwellMs', 'doorCloseMs', 'boardingDelayMs'] as const;
const CONFIG_BOOLEANS = ['directionalCalls', 'occupancyTelemetry', 'autoBoard', 'ambientTraffic'] as const;

/** Przepuszcza tylko znane polecenia panelu symulatora i znane pola konfiguracji. */
function sanitizeSimInput(body: unknown): SimInput {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || !SIM_TYPES.includes(b.type as (typeof SIM_TYPES)[number])) {
    throw new HttpError(400, 'invalid_input', 'Nieznane polecenie symulatora.');
  }
  if (b.type === 'config') {
    const patch: Partial<BuildingConfig> = {};
    const src = (b.patch ?? {}) as Record<string, unknown>;
    for (const k of CONFIG_NUMBERS) if (typeof src[k] === 'number') (patch as Record<string, unknown>)[k] = src[k];
    for (const k of CONFIG_BOOLEANS) if (typeof src[k] === 'boolean') (patch as Record<string, unknown>)[k] = src[k];
    return { type: 'config', patch };
  }
  if (b.type === 'hall_press' && Array.isArray(b.dests) && b.dests.length > 20) {
    throw new HttpError(400, 'invalid_input', 'Za dużo osób naraz.');
  }
  return b as unknown as SimInput;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/health') return json({ ok: true });

  if (!path.startsWith('/api/') && path !== '/ws') {
    if (!env.ASSETS) return error(404, 'not_found', 'Nie znaleziono.');
    return env.ASSETS.fetch(request);
  }

  const mutating = method !== 'GET' && method !== 'HEAD';
  if ((mutating || path === '/ws') && !sameOrigin(request)) {
    return error(403, 'bad_origin', 'Żądanie z niedozwolonego źródła.');
  }

  // ───────── WebSocket ─────────
  if (path === '/ws') {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return error(426, 'upgrade_required', 'Wymagany WebSocket.');
    // Nowy request z czystymi nagłówkami: klient nie podrobi x-winda-*.
    const headers = new Headers({ upgrade: 'websocket' });
    let buildingId: string;
    if (url.searchParams.get('role') === 'admin') {
      if (!(await isAdmin(request, env.ADMIN_PASSWORD, Date.now()))) return error(401, 'unauthorized', 'Wymagane logowanie administratora.');
      buildingId = adminBuilding(url);
      headers.set('x-winda-role', 'admin');
    } else {
      const s = readSession(request);
      if (!s) return error(401, 'unauthorized', 'Ten telefon nie jest aktywowany.');
      buildingId = s.buildingId;
      headers.set('x-winda-installation', s.installationId);
      headers.set('x-winda-secret', s.secret);
    }
    const stub = await building(env, buildingId);
    return stub.fetch(new Request(url.toString(), { headers }));
  }

  // ───────── aktywacja ─────────
  const activationMatch = path.match(/^\/api\/activation\/([^/]+)$/);
  if (activationMatch && method === 'GET') {
    await ipLimit(request, env, 'activation');
    const code = parseActivationCode(decodeURIComponent(activationMatch[1]));
    if (!code) return error(404, 'code_invalid', 'Nie rozpoznajemy tego kodu. Sprawdź, czy skanujesz kod otrzymany od administratora.');
    return respond(await (await building(env, code.buildingId)).activationInfo(code.token));
  }
  if (path === '/api/activation' && method === 'POST') {
    await ipLimit(request, env, 'activation');
    const body = await readJson<{ code?: unknown; name?: unknown; defaultFloor?: unknown }>(request);
    const code = parseActivationCode(body.code);
    if (!code) return error(404, 'code_invalid', 'Nie rozpoznajemy tego kodu. Sprawdź, czy skanujesz kod otrzymany od administratora.');
    const r = await (await building(env, code.buildingId)).activate(code.token, body.name, body.defaultFloor);
    if (!r.ok) return respond(r);
    const { secret, ...rest } = r.data;
    const cookie = sessionCookie(
      SESSION_COOKIE,
      encodeSession({ buildingId: code.buildingId, installationId: rest.installation.installationId, secret }),
      SESSION_MAX_AGE_SEC,
    );
    return json(rest, 201, { 'set-cookie': cookie });
  }

  // ───────── administrator ─────────
  if (path.startsWith('/api/admin/')) return handleAdmin(request, env, url);

  // ───────── mieszkaniec (wymaga sesji) ─────────
  const s = readSession(request);
  if (!s) return error(401, 'unauthorized', 'Ten telefon nie jest aktywowany. Zeskanuj kod QR od administratora.');
  const auth: Auth = { installationId: s.installationId, secret: s.secret };
  const stub = await building(env, s.buildingId);

  if (path === '/api/me' && method === 'GET') return respond(await stub.me(auth));
  if (path === '/api/me' && method === 'PATCH') {
    const body = await readJson<{ name?: unknown; defaultFloor?: unknown }>(request);
    return respond(await stub.updateMe(auth, { name: body.name, defaultFloor: body.defaultFloor }));
  }
  if (path === '/api/state' && method === 'GET') return respond(await stub.state(auth));
  if (path === '/api/calls' && method === 'POST') {
    const body = await readJson<{ requestId?: unknown; floor?: unknown; passengerCount?: unknown; direction?: unknown }>(request);
    // buildingId z treści żądania jest ignorowany: budynek wynika wyłącznie z sesji.
    return respond(await stub.appCall(auth, { requestId: body.requestId, floor: body.floor, passengerCount: body.passengerCount, direction: body.direction }));
  }
  const callMatch = path.match(/^\/api\/calls\/([A-Za-z0-9-]{1,64})$/);
  if (callMatch && method === 'PATCH') {
    const body = await readJson<{ passengerCount?: unknown }>(request);
    return respond(await stub.updatePassengerCount(auth, callMatch[1], body.passengerCount));
  }
  if (callMatch && method === 'DELETE') return respond(await stub.cancel(auth, callMatch[1]));

  return error(404, 'not_found', 'Nie znaleziono.');
}

function adminBuilding(url: URL): string {
  const id = url.searchParams.get('building') ?? DEMO_BUILDING.buildingId;
  if (!BUILDINGS[id]) throw new HttpError(404, 'not_found', 'Nieznany budynek.');
  return id;
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const now = Date.now();

  if (!env.ADMIN_PASSWORD) return error(503, 'admin_disabled', 'Panel administratora jest wyłączony (brak ADMIN_PASSWORD).');

  if (path === '/api/admin/login' && method === 'POST') {
    await ipLimit(request, env, 'admin-login');
    const body = await readJson<{ password?: unknown }>(request);
    if (typeof body.password !== 'string' || !safeEqual(body.password, env.ADMIN_PASSWORD)) {
      return error(401, 'unauthorized', 'Nieprawidłowe hasło.');
    }
    const token = await createAdminToken(env.ADMIN_PASSWORD, now);
    return json({ admin: true }, 200, { 'set-cookie': sessionCookie(ADMIN_COOKIE, token, ADMIN_MAX_AGE_SEC) });
  }
  if (path === '/api/admin/logout' && method === 'POST') {
    return json({ admin: false }, 200, { 'set-cookie': clearCookie(ADMIN_COOKIE) });
  }
  const admin = await isAdmin(request, env.ADMIN_PASSWORD, now);
  if (path === '/api/admin/session' && method === 'GET') return json({ admin });
  if (!admin) return error(401, 'unauthorized', 'Wymagane logowanie administratora.');

  if (path === '/api/admin/buildings' && method === 'GET') {
    return json(Object.values(BUILDINGS).map((b) => ({ id: b.buildingId, name: b.name, address: b.address })));
  }

  const stub = await building(env, adminBuilding(url));
  if (path === '/api/admin/state' && method === 'GET') return json(await stub.adminState());
  if (path === '/api/admin/codes' && method === 'POST') {
    const body = await readJson<{ ttlHours?: unknown }>(request);
    const ttlMs = typeof body.ttlHours === 'number' ? Math.round(body.ttlHours * 3600 * 1000) : undefined;
    return respond(await stub.createCode(url.origin, ttlMs));
  }
  if (path === '/api/admin/installations' && method === 'GET') return json(await stub.listInstallations());
  const instMatch = path.match(/^\/api\/admin\/installations\/([A-Za-z0-9_-]{1,64})$/);
  if (instMatch && method === 'DELETE') return respond(await stub.revoke(instMatch[1]));
  if (path === '/api/admin/sim' && method === 'POST') {
    return respond(await stub.simInput(sanitizeSimInput(await readJson(request))));
  }
  if (path === '/api/admin/reset' && method === 'POST') {
    await stub.reset();
    return json({ ok: true });
  }
  return error(404, 'not_found', 'Nie znaleziono.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.code, e.message);
      console.error(e);
      return error(500, 'internal', 'Błąd serwera. Spróbuj ponownie.');
    }
  },
} satisfies ExportedHandler<Env>;
