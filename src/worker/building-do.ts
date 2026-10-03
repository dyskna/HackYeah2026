/**
 * Jeden Durable Object na budynek: jedyne źródło prawdy o windzie, kolejce,
 * przydziałach grup oraz o instalacjach (telefonach) i kodach aktywacyjnych.
 *
 * - Stan windy zapisywany trwale po każdej zmianie; alarm budzi obiekt na
 *   kolejne przejście symulacji (koniec odcinka, drzwi…).
 * - Klienci dostają stan przez WebSocket (API hibernacji). Każda zmiana
 *   wysyła nową wersję widoku; każdy telefon widzi tylko własne zgłoszenie.
 * - Dostęp sprawdzany przy każdym wywołaniu: skrót sekretu sesji i brak cofnięcia.
 */
import { DurableObject } from 'cloudflare:workers';
import { Building } from '../engine/building';
import type { BuildingSnapshot, SimInput } from '../engine/building';
import type { CallError, CallResult, Notice } from '../engine/core';
import { buildingInfo, myCallView as toMyCall, residentView } from '../engine/view';
import type { BuildingConfig } from '../shared/config';
import { BUILDINGS, PUBLIC_DEMO_TOKEN } from '../shared/config';
import type { ControllerEvent } from '../shared/events';
import type { Direction } from '../shared/model';
import { isActive } from '../shared/model';
import type {
  ActivationCodeView,
  AdminInstallationView,
  BuildingInfo,
  ClientMessage,
  InstallationView,
  MyCallView,
  ResidentView,
  ServerMessage,
} from '../shared/protocol';
import { randomToken, safeEqual, sha256, TokenBuckets } from './security';

const STATE_KEY = 'building';
const INST_PREFIX = 'inst:';
const CODE_PREFIX = 'code:';
const DEFAULT_CODE_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_CODE_TTL_MS = 30 * 24 * 3600 * 1000;
const LAST_SEEN_WRITE_MS = 60_000;

export interface Env {
  BUILDING: DurableObjectNamespace<BuildingDO>;
  ASSETS?: Fetcher;
  ADMIN_PASSWORD?: string;
  /** Limiter żądań per IP (aktywacja, logowanie administratora). */
  IP_LIMITER?: RateLimit;
  /**
   * Stały kod demonstracyjny (jeden QR dla wszystkich telefonów): wielokrotnego
   * użytku, bez wygaśnięcia. Brak zmiennej = tylko kody jednorazowe od administratora.
   */
  DEMO_ACTIVATION_CODE?: string;
}

interface InstallationRecord {
  installationId: string;
  secretHash: string;
  name: string | null;
  defaultFloor: number;
  activatedAt: number;
  revokedAt: number | null;
  lastSeenAt: number | null;
}

interface CodeRecord {
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
}

export interface Auth {
  installationId: string;
  secret: string;
}

/** Wynik operacji: dane albo błąd z kodem HTTP i komunikatem dla użytkownika. */
export type DoResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; message: string };

interface SocketAttachment {
  role: 'resident' | 'admin';
  installationId: string | null;
}

function fail(status: number, error: string, message: string): DoResult<never> {
  return { ok: false, status, error, message };
}

function ok<T>(data: T, status = 200): DoResult<T> {
  return { ok: true, status, data };
}

const CALL_ERRORS: Record<CallError, [number, string]> = {
  fault: [409, 'Winda niedostępna. Nowe wezwania są zablokowane do czasu usunięcia awarii.'],
  invalid_request: [400, 'Nieprawidłowe żądanie.'],
  invalid_floor: [400, 'Nieprawidłowe piętro.'],
  invalid_count: [400, 'Liczba osób musi być dodatnią liczbą całkowitą.'],
  group_too_large: [422, 'Grupa jest większa niż pojemność kabiny. Podzielcie się na kilka przejazdów.'],
  direction_required: [400, 'Wybierz kierunek: W górę albo W dół.'],
  invalid_direction: [400, 'Z tego piętra nie można jechać w wybranym kierunku.'],
  active_call_exists: [409, 'Ten telefon ma już aktywne wezwanie w tym budynku.'],
  not_found: [404, 'Nie znaleziono wezwania.'],
  forbidden: [403, 'Możesz zmieniać tylko własne wezwanie.'],
  not_modifiable: [409, 'Tego wezwania nie można już zmienić.'],
};

export class BuildingDO extends DurableObject<Env> {
  private building: Building | null = null;
  private mutations = new TokenBuckets(20, 0.5);
  private reads = new TokenBuckets(60, 2);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<BuildingSnapshot>(STATE_KEY);
      if (saved) {
        // Nowe pola konfiguracji z kodu uzupełniają zapisany stan (zapisane wartości wygrywają).
        const defaults = BUILDINGS[saved.core.config.buildingId];
        if (defaults) saved.core.config = { ...defaults, ...saved.core.config };
        this.building = new Building(saved);
        // Wznowienie: dogonienie przejść, które minęły, gdy obiekt nie działał.
        this.building.run(Date.now());
        await this.persist();
      }
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  /** Tworzy budynek przy pierwszym użyciu. Kolejne wywołania nic nie zmieniają. */
  async init(buildingId: string): Promise<void> {
    if (this.building) return;
    const config: BuildingConfig | undefined = BUILDINGS[buildingId];
    if (!config) throw new Error(`Nieznany budynek: ${buildingId}`);
    this.building = Building.create(config, Date.now());
    await this.persist();
  }

  private get b(): Building {
    if (!this.building) throw new Error('Budynek nie został zainicjowany');
    return this.building;
  }

  private async persist(): Promise<void> {
    const b = this.b;
    b.prune(Date.now());
    await this.ctx.storage.put(STATE_KEY, b.state);
    const wake = b.nextWakeAt();
    if (wake === null || !Number.isFinite(wake)) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(wake);
  }

  /** Zapis + rozesłanie nowej wersji stanu do wszystkich połączonych klientów. */
  private async commit(): Promise<void> {
    await this.persist();
    this.broadcast(this.b.drainNotices());
  }

  async alarm(): Promise<void> {
    if (!this.building) return;
    this.building.run(Date.now());
    // Ktoś jest połączony: ruch tła trwa dalej.
    if (this.ctx.getWebSockets().length > 0) this.building.keepAlive(Date.now());
    await this.commit();
  }

  // ───────────────────────── dostęp ─────────────────────────

  private async authenticate(auth: Auth): Promise<DoResult<InstallationRecord>> {
    const rec = await this.ctx.storage.get<InstallationRecord>(INST_PREFIX + auth.installationId);
    if (!rec || !safeEqual(rec.secretHash, await sha256(auth.secret))) {
      return fail(401, 'unauthorized', 'Ten telefon nie jest aktywowany w tym budynku.');
    }
    if (rec.revokedAt !== null) return fail(401, 'revoked', 'Administrator cofnął dostęp dla tego telefonu.');
    const now = Date.now();
    if (!rec.lastSeenAt || now - rec.lastSeenAt > LAST_SEEN_WRITE_MS) {
      rec.lastSeenAt = now;
      await this.ctx.storage.put(INST_PREFIX + rec.installationId, rec);
    }
    return ok(rec);
  }

  private limited(bucket: TokenBuckets, key: string): DoResult<never> | null {
    return bucket.take(key, Date.now()) ? null : fail(429, 'rate_limited', 'Zbyt wiele żądań. Spróbuj za chwilę.');
  }

  // ───────────────────────── aktywacja ─────────────────────────

  private async findCode(token: string): Promise<{ key: string | null; rec: CodeRecord } | null> {
    if (this.b.config.publicDemo && token === PUBLIC_DEMO_TOKEN) {
      return { key: null, rec: { createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, usedAt: null, usedBy: null } };
    }
    const demo = this.env.DEMO_ACTIVATION_CODE;
    if (demo && demo.length >= 20 && safeEqual(token, demo)) {
      return { key: null, rec: { createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, usedAt: null, usedBy: null } };
    }
    const key = CODE_PREFIX + (await sha256(token));
    const rec = await this.ctx.storage.get<CodeRecord>(key);
    return rec ? { key, rec } : null;
  }

  private codeError(found: { rec: CodeRecord } | null, now: number): DoResult<never> | null {
    if (!found) return fail(404, 'code_invalid', 'Nie rozpoznajemy tego kodu. Sprawdź, czy skanujesz kod otrzymany od administratora.');
    if (found.rec.usedAt !== null) return fail(410, 'code_used', 'Każdy kod aktywuje tylko jeden telefon.');
    if (found.rec.expiresAt < now) return fail(410, 'code_expired', 'Ten kod aktywacyjny stracił ważność.');
    return null;
  }

  /** Dane budynku dla ekranu aktywacji. Nie zużywa kodu. */
  async activationInfo(token: string): Promise<DoResult<{ building: BuildingInfo; expiresAt: number; reusable: boolean }>> {
    const found = await this.findCode(token);
    const err = this.codeError(found, Date.now());
    if (err) return err;
    return ok({ building: buildingInfo(this.b.config), expiresAt: found!.rec.expiresAt, reusable: found!.key === null });
  }

  /** Zużywa kod i tworzy nową instalację. Zwraca sekret sesji (trafia tylko do ciasteczka). */
  async activate(
    token: string,
    name: unknown,
    defaultFloor: unknown,
  ): Promise<DoResult<{ installation: InstallationView; building: BuildingInfo; secret: string }>> {
    const now = Date.now();
    const found = await this.findCode(token);
    const err = this.codeError(found, now);
    if (err) return err;
    const cfg = this.b.config;
    const floor = Number.isInteger(defaultFloor) && (defaultFloor as number) >= cfg.minFloor && (defaultFloor as number) <= cfg.maxFloor
      ? (defaultFloor as number)
      : cfg.minFloor;
    const secret = randomToken(32);
    const rec: InstallationRecord = {
      installationId: randomToken(12),
      secretHash: await sha256(secret),
      name: cleanName(name),
      defaultFloor: floor,
      activatedAt: now,
      revokedAt: null,
      lastSeenAt: now,
    };
    if (found!.key === null) {
      // Kod demonstracyjny: wielokrotnego użytku, nie zapisujemy wykorzystania.
      await this.ctx.storage.put(INST_PREFIX + rec.installationId, rec);
    } else {
      found!.rec.usedAt = now;
      found!.rec.usedBy = rec.installationId;
      // Oba zapisy w jednej partii: kod nie aktywuje drugiego telefonu.
      await this.ctx.storage.put({ [found!.key]: found!.rec, [INST_PREFIX + rec.installationId]: rec });
    }
    return ok({ installation: instView(rec), building: buildingInfo(cfg), secret }, 201);
  }

  // ───────────────────────── mieszkaniec ─────────────────────────

  async me(auth: Auth): Promise<DoResult<{ installation: InstallationView; building: BuildingInfo }>> {
    const a = await this.authenticate(auth);
    if (!a.ok) return a;
    return ok({ installation: instView(a.data), building: buildingInfo(this.b.config) });
  }

  async updateMe(auth: Auth, patch: { name?: unknown; defaultFloor?: unknown }): Promise<DoResult<{ installation: InstallationView }>> {
    const a = await this.authenticate(auth);
    if (!a.ok) return a;
    const lim = this.limited(this.mutations, auth.installationId);
    if (lim) return lim;
    const rec = a.data;
    const cfg = this.b.config;
    if (patch.defaultFloor !== undefined) {
      const f = patch.defaultFloor;
      if (!Number.isInteger(f) || (f as number) < cfg.minFloor || (f as number) > cfg.maxFloor) {
        return fail(400, 'invalid_floor', 'Nieprawidłowe piętro.');
      }
      rec.defaultFloor = f as number;
    }
    if (patch.name !== undefined) rec.name = cleanName(patch.name);
    await this.ctx.storage.put(INST_PREFIX + rec.installationId, rec);
    return ok({ installation: instView(rec) });
  }

  async state(auth: Auth): Promise<DoResult<ResidentView>> {
    const a = await this.authenticate(auth);
    if (!a.ok) return a;
    const lim = this.limited(this.reads, auth.installationId);
    if (lim) return lim;
    const now = Date.now();
    this.b.run(now);
    return ok(residentView(this.b.state.core, auth.installationId, now));
  }

  async appCall(
    auth: Auth,
    input: { requestId: unknown; floor: unknown; passengerCount: unknown; direction?: unknown },
  ): Promise<DoResult<{ call: MyCallView; created: boolean }>> {
    const a = await this.authenticate(auth);
    if (!a.ok) return a;
    // Ponowienie z tym samym requestId nie jest liczone do limitu: zwraca to samo zgłoszenie.
    const existing = this.b.state.core.calls.find((c) => c.installationId === auth.installationId && c.requestId === input.requestId);
    if (!existing) {
      const lim = this.limited(this.mutations, auth.installationId);
      if (lim) return lim;
    }
    const r = this.b.appCall(
      {
        requestId: typeof input.requestId === 'string' ? input.requestId : '',
        installationId: auth.installationId,
        floor: input.floor as number,
        passengerCount: input.passengerCount as number,
        direction: input.direction === 'up' || input.direction === 'down' ? (input.direction as Direction) : null,
      },
      Date.now(),
    );
    if (r.ok && r.created) await this.commit();
    return this.callResult(r, auth.installationId, r.ok && r.created ? 201 : 200);
  }

  async updatePassengerCount(auth: Auth, callId: string, count: unknown): Promise<DoResult<{ call: MyCallView; created: boolean }>> {
    const a = await this.authenticate(auth);
    if (!a.ok) return a;
    const lim = this.limited(this.mutations, auth.installationId);
    if (lim) return lim;
    const r = this.b.updatePassengerCount(auth.installationId, callId, count as number, Date.now());
    if (r.ok) await this.commit();
    return this.callResult(r, auth.installationId);
  }

  async cancel(auth: Auth, callId: string): Promise<DoResult<{ call: MyCallView; created: boolean }>> {
    const a = await this.authenticate(auth);
    if (!a.ok) return a;
    const lim = this.limited(this.mutations, auth.installationId);
    if (lim) return lim;
    const r = this.b.cancel(auth.installationId, callId, Date.now());
    if (r.ok) await this.commit();
    return this.callResult(r, auth.installationId);
  }

  private callResult(r: CallResult, installationId: string, status = 200): DoResult<{ call: MyCallView; created: boolean }> {
    if (!r.ok) {
      const [code, message] = CALL_ERRORS[r.error];
      const msg = r.error === 'group_too_large'
        ? `Grupa jest większa niż pojemność kabiny (${this.b.config.capacity} osób). Podzielcie się na kilka przejazdów.`
        : message;
      return fail(code, r.error, msg);
    }
    // Zwracamy zgłoszenie w kształcie widoku mieszkańca (bez pól wewnętrznych).
    const view = residentView(this.b.state.core, installationId, Date.now());
    const call = view.myCall && view.myCall.callId === r.call.callId ? view.myCall : toMyCall(r.call);
    return ok({ call, created: r.created }, status);
  }

  // ───────────────────────── administrator ─────────────────────────

  async adminState(): Promise<unknown> {
    const now = Date.now();
    this.b.run(now);
    return { serverNow: now, ...this.adminPayload() };
  }

  private adminPayload() {
    const s = this.b.state;
    return {
      version: s.core.version,
      core: s.core,
      sim: {
        phase: s.sim.phase,
        floor: s.sim.floor,
        passengers: s.sim.passengers.length,
        hallWaiting: s.sim.hallWaiting.map((w) => ({ floor: w.floor, count: w.dests.length })),
      },
    };
  }

  async createCode(origin: string, ttlMs?: number): Promise<DoResult<ActivationCodeView>> {
    const now = Date.now();
    const ttl = Number.isInteger(ttlMs) && ttlMs! > 0 ? Math.min(ttlMs!, MAX_CODE_TTL_MS) : DEFAULT_CODE_TTL_MS;
    const token = randomToken(24);
    const rec: CodeRecord = { createdAt: now, expiresAt: now + ttl, usedAt: null, usedBy: null };
    await this.ctx.storage.put(CODE_PREFIX + (await sha256(token)), rec);
    const code = `${this.b.config.buildingId}.${token}`;
    // Kod w części # adresu: nie trafia do logów serwera ani nagłówka Referer.
    return ok({ code, url: `${origin}/aktywacja#${code}`, expiresAt: rec.expiresAt }, 201);
  }

  async listInstallations(): Promise<AdminInstallationView[]> {
    const all = await this.ctx.storage.list<InstallationRecord>({ prefix: INST_PREFIX });
    return [...all.values()]
      .map((r) => ({ ...instView(r), revokedAt: r.revokedAt, lastSeenAt: r.lastSeenAt }))
      .sort((a, b) => b.activatedAt - a.activatedAt);
  }

  /** Cofnięcie dostępu: anuluje aktywne wezwanie telefonu i zamyka jego połączenia. */
  async revoke(installationId: string): Promise<DoResult<{ revoked: true }>> {
    const rec = await this.ctx.storage.get<InstallationRecord>(INST_PREFIX + installationId);
    if (!rec) return fail(404, 'not_found', 'Nie znaleziono instalacji.');
    if (rec.revokedAt === null) {
      const now = Date.now();
      rec.revokedAt = now;
      await this.ctx.storage.put(INST_PREFIX + installationId, rec);
      const active = this.b.state.core.calls.find((c) => c.installationId === installationId && isActive(c));
      if (active) this.b.cancel(installationId, active.callId, now);
      for (const ws of this.ctx.getWebSockets(installationId)) {
        try {
          ws.send(JSON.stringify({ type: 'revoked' } satisfies ServerMessage));
          ws.close(4001, 'revoked');
        } catch {
          /* już zamknięte */
        }
      }
      await this.commit();
    }
    return ok({ revoked: true });
  }

  async simInput(input: SimInput): Promise<DoResult<{ ok: true }>> {
    const r = this.b.simInput(input, Date.now());
    if (!r.ok) return fail(400, r.error ?? 'invalid_input', 'Nieprawidłowe polecenie symulatora.');
    await this.commit();
    return ok({ ok: true });
  }

  /** Nowa symulacja od zera (kabina na parterze, pusta kolejka). Instalacje zostają. */
  async reset(): Promise<void> {
    const cfg = this.b.config;
    this.building = Building.create(cfg, Date.now());
    this.building.state.core.version = Date.now(); // wersja rośnie, klienci nie odrzucą nowego stanu
    await this.commit();
  }

  /** Wejście dla adaptera prawdziwego sterownika (ten sam format zdarzeń co symulator). */
  async controllerEvent(e: ControllerEvent): Promise<void> {
    this.b.controllerEvent(e, Date.now());
    await this.commit();
  }

  // ───────────────────────── WebSocket ─────────────────────────

  /**
   * Połączenie WebSocket. Worker weryfikuje pochodzenie i przekazuje tożsamość
   * w nagłówkach x-winda-* (nagłówki od klienta są wcześniej usuwane).
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    let att: SocketAttachment;
    if (request.headers.get('x-winda-role') === 'admin') {
      att = { role: 'admin', installationId: null };
    } else {
      const auth = { installationId: request.headers.get('x-winda-installation') ?? '', secret: request.headers.get('x-winda-secret') ?? '' };
      const a = await this.authenticate(auth);
      if (!a.ok) return new Response(a.message, { status: a.status });
      att = { role: 'resident', installationId: auth.installationId };
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [att.installationId ?? 'admin']);
    server.serializeAttachment(att);
    this.b.keepAlive(Date.now());
    await this.persist();
    this.send(server, att, true);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > 256) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'sync') {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att) return;
      this.b.run(Date.now());
      this.send(ws, att, true);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* już zamknięte */
    }
  }

  private send(ws: WebSocket, att: SocketAttachment, full: boolean): void {
    const now = Date.now();
    let msg: ServerMessage;
    if (att.role === 'admin') {
      msg = { type: 'admin', serverNow: now, ...this.adminPayload() };
    } else {
      const view = residentView(this.b.state.core, att.installationId, now);
      msg = full ? { type: 'snapshot', view } : { type: 'update', view };
    }
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* gniazdo w trakcie zamykania */
    }
  }

  private broadcast(notices: Notice[]): void {
    const version = this.b.state.core.version;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att) continue;
      this.send(ws, att, false);
      for (const n of notices) {
        // Mieszkaniec dostaje komunikaty o własnym wezwaniu i ogólne (awaria).
        const relevant = att.role === 'admin' || n.callId === null || (n.installationId !== null && n.installationId === att.installationId);
        if (!relevant) continue;
        try {
          ws.send(JSON.stringify({ type: 'notice', version, notice: { kind: n.kind, callId: n.callId } } satisfies ServerMessage));
        } catch {
          /* pomijamy */
        }
      }
    }
  }
}

function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return n || null;
}

function instView(r: InstallationRecord): InstallationView {
  return { installationId: r.installationId, name: r.name, defaultFloor: r.defaultFloor, activatedAt: r.activatedAt };
}
