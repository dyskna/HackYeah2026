/**
 * Symulator windy. Zastępuje sprzęt: wykonuje polecenia (`go`, `open`)
 * i emituje te same ControllerEvent, które wysyłałby adapter sterownika.
 *
 * Symulator zna rzeczy, których serwer nie zna: cele pasażerów i liczbę osób
 * czekających przy przycisku piętrowym. Serwer dowiaduje się o nich wyłącznie
 * ze zdarzeń (wejścia, wyjścia, zajętość, przyciski kabinowe).
 */
import type { BuildingConfig } from '../shared/config';
import type { ControllerCommand, ControllerEvent, ControllerEventBody } from '../shared/events';
import type { Direction } from '../shared/model';

export type SimPhase = 'idle' | 'moving' | 'doors_opening' | 'doors_open' | 'doors_closing' | 'fault';

export interface SimPassenger {
  dest: number;
  callId: string | null;
}

export interface SimState {
  phase: SimPhase;
  floor: number;
  direction: Direction | null;
  moveTo: number | null;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  passengers: SimPassenger[];
  /** Osoby czekające przy przycisku piętrowym (z celami). */
  hallWaiting: { floor: number; dests: number[] }[];
  /** Grupy z aplikacji, które mają wsiąść na bieżącym postoju. */
  groupBoardings: { callId: string; count: number; dest: number }[];
  boardingAt: number | null;
  frozen: { phase: SimPhase; remainingMs: number } | null;
  seq: number;
  /** Ruch tła: następne naciśnięcie przycisku i koniec okna aktywności. */
  ambientAt?: number | null;
  ambientUntil?: number;
  rng?: number;
}

export function initialSimState(cfg: BuildingConfig, now: number): SimState {
  return {
    phase: 'idle',
    floor: cfg.minFloor,
    direction: null,
    moveTo: null,
    phaseStartedAt: now,
    phaseEndsAt: null,
    passengers: [],
    hallWaiting: [],
    groupBoardings: [],
    boardingAt: null,
    frozen: null,
    seq: 0,
  };
}

const SOURCE = 'sim';

export class Simulator {
  constructor(
    public s: SimState,
    private cfg: () => BuildingConfig,
  ) {}

  private ev(at: number, body: ControllerEventBody, sourceId = SOURCE): ControllerEvent {
    this.s.seq += 1;
    return { eventId: `sim-${this.s.seq}`, at, sourceId, ...body } as ControllerEvent;
  }

  private occupancyEvent(at: number): ControllerEvent {
    return this.ev(at, { type: 'occupancy', count: this.cfg().occupancyTelemetry ? this.s.passengers.length : null });
  }

  nextTransitionAt(): number | null {
    if (this.s.phase === 'fault') return null;
    const times = [this.s.phaseEndsAt, this.s.boardingAt, this.ambientDue()].filter((x): x is number => x !== null);
    return times.length ? Math.min(...times) : null;
  }

  // ───────────────────────── ruch tła ─────────────────────────

  /** Deterministyczny generator liczb (stan w zapisie, więc restart nie zmienia przebiegu). */
  private random(): number {
    let x = (this.s.rng ?? 0x2545f491) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s.rng = x >>> 0;
    return this.s.rng / 0x100000000;
  }

  private ambientDue(): number | null {
    const s = this.s;
    if (!this.cfg().ambientTraffic || !Number.isFinite(s.ambientAt) || (s.ambientUntil ?? 0) < s.ambientAt!) return null;
    return s.ambientAt!;
  }

  /** Podtrzymuje ruch tła do `until` (ktoś ogląda aplikację). */
  keepAmbientAlive(now: number, until: number): void {
    const s = this.s;
    s.ambientUntil = Math.max(Number.isFinite(s.ambientUntil) ? s.ambientUntil! : 0, until);
    if (!Number.isFinite(s.ambientAt) || s.ambientAt! < now) s.ambientAt = now + this.ambientGap();
  }

  private ambientGap(): number {
    const c = this.cfg();
    return Math.round(c.ambientMinMs + this.random() * Math.max(0, c.ambientMaxMs - c.ambientMinMs));
  }

  /** Symulowany mieszkaniec naciska przycisk: zwykle zjazd na parter, czasem wjazd z parteru. */
  private ambientPress(t: number): ControllerEvent[] {
    const s = this.s;
    const c = this.cfg();
    s.ambientAt = t + this.ambientGap();
    if (s.hallWaiting.length >= 2) return [];
    const fromGround = this.random() < 0.3;
    const floor = fromGround ? c.minFloor : c.minFloor + 1 + Math.floor(this.random() * (c.maxFloor - c.minFloor));
    const count = 1 + Math.floor(this.random() * 3);
    const dests = Array.from({ length: count }, () =>
      fromGround ? c.minFloor + 1 + Math.floor(this.random() * (c.maxFloor - c.minFloor)) : c.minFloor,
    );
    return this.pressHall(floor, null, dests, t);
  }

  /** Wykonuje najbliższe przejście zaplanowane na czas `t`. */
  advance(t: number): ControllerEvent[] {
    const s = this.s;
    const cfg = this.cfg();
    const amb = this.ambientDue();
    if (amb !== null && amb <= t && (s.phaseEndsAt === null || amb <= s.phaseEndsAt) && (s.boardingAt === null || amb <= s.boardingAt)) {
      return this.ambientPress(amb);
    }
    if (s.boardingAt !== null && s.boardingAt <= t && (s.phaseEndsAt === null || s.boardingAt <= s.phaseEndsAt)) {
      s.boardingAt = null;
      return s.phase === 'doors_open' ? this.board(t) : [];
    }
    if (s.phaseEndsAt === null || s.phaseEndsAt > t) return [];
    const at = s.phaseEndsAt;
    switch (s.phase) {
      case 'moving': {
        s.floor = s.moveTo ?? s.floor;
        s.moveTo = null;
        this.setPhase('idle', at, null);
        return [this.ev(at, { type: 'position', floor: s.floor, direction: s.direction })];
      }
      case 'doors_opening': {
        const out: ControllerEvent[] = [];
        const before = s.passengers.length;
        s.passengers = s.passengers.filter((p) => p.dest !== s.floor);
        const exited = before - s.passengers.length;
        if (exited > 0) {
          out.push(this.ev(at, { type: 'passengers', floor: s.floor, entered: 0, exited, boardedCallId: null }));
          out.push(this.occupancyEvent(at));
        }
        this.setPhase('doors_open', at, at + cfg.doorDwellMs);
        out.push(this.ev(at, { type: 'door', state: 'open', floor: s.floor, endsAt: s.phaseEndsAt }));
        if (s.hallWaiting.some((w) => w.floor === s.floor) || s.groupBoardings.length > 0) {
          s.boardingAt = at + cfg.boardingDelayMs;
        }
        return out;
      }
      case 'doors_open': {
        const out = s.boardingAt !== null ? this.board(at) : [];
        s.boardingAt = null;
        s.groupBoardings = [];
        this.setPhase('doors_closing', at, at + cfg.doorCloseMs);
        out.push(this.ev(at, { type: 'door', state: 'closing', floor: s.floor, endsAt: s.phaseEndsAt }));
        return out;
      }
      case 'doors_closing': {
        this.setPhase('idle', at, null);
        return [this.ev(at, { type: 'door', state: 'closed', floor: s.floor, endsAt: null })];
      }
      default:
        return [];
    }
  }

  private board(at: number): ControllerEvent[] {
    const s = this.s;
    const cfg = this.cfg();
    const out: ControllerEvent[] = [];
    const newDests = new Set<number>();
    // Najpierw grupy z potwierdzonym przydziałem, potem osoby spod przycisku.
    for (const g of s.groupBoardings) {
      for (let i = 0; i < g.count; i++) s.passengers.push({ dest: g.dest, callId: g.callId });
      newDests.add(g.dest);
      out.push(this.ev(at, { type: 'passengers', floor: s.floor, entered: g.count, exited: 0, boardedCallId: g.callId }));
    }
    s.groupBoardings = [];
    let entered = 0;
    // Osoby spod jednego przycisku wsiadają razem albo czekają na kolejny przejazd.
    for (const w of s.hallWaiting.filter((x) => x.floor === s.floor)) {
      if (w.dests.length > cfg.capacity - s.passengers.length) continue;
      for (const dest of w.dests.splice(0)) {
        s.passengers.push({ dest, callId: null });
        newDests.add(dest);
        entered++;
      }
    }
    s.hallWaiting = s.hallWaiting.filter((w) => w.dests.length > 0);
    if (entered > 0) out.push(this.ev(at, { type: 'passengers', floor: s.floor, entered, exited: 0, boardedCallId: null }));
    if (out.length > 0) out.push(this.occupancyEvent(at));
    for (const d of newDests) {
      if (d !== s.floor) out.push(this.ev(at, { type: 'car_call', floor: d }, 'sim-car'));
    }
    return out;
  }

  private setPhase(phase: SimPhase, at: number, endsAt: number | null) {
    this.s.phase = phase;
    this.s.phaseStartedAt = at;
    this.s.phaseEndsAt = endsAt;
  }

  /** Polecenie z serwera (w realnej instalacji: do sterownika). */
  command(cmd: ControllerCommand, t: number): ControllerEvent[] {
    const s = this.s;
    const cfg = this.cfg();
    if (s.phase !== 'idle') return [];
    if (cmd.type === 'open') {
      this.setPhase('doors_opening', t, t + cfg.doorOpenMs);
      return [this.ev(t, { type: 'door', state: 'opening', floor: s.floor, endsAt: s.phaseEndsAt })];
    }
    const to = s.floor + (cmd.direction === 'up' ? 1 : -1);
    if (to < cfg.minFloor || to > cfg.maxFloor) return [];
    s.direction = cmd.direction;
    s.moveTo = to;
    this.setPhase('moving', t, t + cfg.travelPerFloorMs);
    const out = [this.ev(t, { type: 'motion', from: s.floor, to, endsAt: s.phaseEndsAt! })];
    // Kto się nie zmieścił, naciska przycisk ponownie, gdy kabina odjedzie.
    if (s.hallWaiting.some((w) => w.floor === s.floor)) {
      out.push(this.ev(t, { type: 'hall_call', floor: s.floor, direction: null }, `sim-hall-${s.floor}`));
    }
    return out;
  }

  // ───────────────────────── wejścia z panelu symulatora ─────────────────────────

  /** Przycisk piętrowy. `dests` to cele osób, które czekają (serwer ich nie zna). */
  pressHall(floor: number, direction: Direction | null, dests: number[], t: number): ControllerEvent[] {
    // Grupa większa niż kabina dzieli się na części, które zmieszczą się w całości.
    const cap = this.cfg().capacity;
    for (let i = 0; i < dests.length; i += cap) this.s.hallWaiting.push({ floor, dests: dests.slice(i, i + cap) });
    return [this.ev(t, { type: 'hall_call', floor, direction }, `sim-hall-${floor}`)];
  }

  pressCar(floor: number, t: number): ControllerEvent[] {
    return [this.ev(t, { type: 'car_call', floor }, 'sim-car')];
  }

  /** Grupa z aplikacji wsiada (automatycznie po przyjeździe albo z panelu). */
  boardGroup(callId: string, count: number, dest: number, t: number, immediate = false): ControllerEvent[] {
    const s = this.s;
    if (s.phase !== 'doors_open' && s.phase !== 'doors_opening') return [];
    s.groupBoardings.push({ callId, count, dest });
    if (s.phase === 'doors_open') {
      const due = immediate ? t : s.phaseStartedAt + this.cfg().boardingDelayMs;
      if (due <= t) return this.board(t);
      s.boardingAt = s.boardingAt === null ? due : Math.min(s.boardingAt, due);
    }
    return [];
  }

  /** Ręczne wejście pasażerów na bieżącym piętrze (drzwi otwarte). */
  enter(count: number, dest: number, t: number): ControllerEvent[] {
    const s = this.s;
    const room = Math.max(0, this.cfg().capacity - s.passengers.length);
    const n = Math.min(count, room);
    if (n <= 0) return [];
    for (let i = 0; i < n; i++) s.passengers.push({ dest, callId: null });
    const out = [this.ev(t, { type: 'passengers', floor: s.floor, entered: n, exited: 0, boardedCallId: null }), this.occupancyEvent(t)];
    if (dest !== s.floor) out.push(this.ev(t, { type: 'car_call', floor: dest }, 'sim-car'));
    return out;
  }

  /** Ręczne wyjście pasażerów na bieżącym piętrze. */
  exit(count: number, t: number): ControllerEvent[] {
    const s = this.s;
    const n = Math.min(count, s.passengers.length);
    if (n <= 0) return [];
    s.passengers.splice(0, n);
    return [this.ev(t, { type: 'passengers', floor: s.floor, entered: 0, exited: n, boardedCallId: null }), this.occupancyEvent(t)];
  }

  /** Ponowne wysłanie zajętości (np. po włączeniu/wyłączeniu telemetrii). */
  reportOccupancy(t: number): ControllerEvent[] {
    return [this.occupancyEvent(t)];
  }

  setFault(active: boolean, reason: string | null, t: number): ControllerEvent[] {
    const s = this.s;
    if (active && s.phase !== 'fault') {
      s.frozen = { phase: s.phase, remainingMs: s.phaseEndsAt === null ? 0 : Math.max(0, s.phaseEndsAt - t) };
      s.boardingAt = null;
      this.setPhase('fault', t, null);
      return [this.ev(t, { type: 'fault', active: true, reason: reason ?? 'Awaria' })];
    }
    if (!active && s.phase === 'fault') {
      const fr = s.frozen ?? { phase: 'idle' as SimPhase, remainingMs: 0 };
      s.frozen = null;
      const out = [this.ev(t, { type: 'fault', active: false, reason: null })];
      const endsAt = t + fr.remainingMs;
      switch (fr.phase) {
        case 'moving':
          this.setPhase('moving', t, endsAt);
          out.push(this.ev(t, { type: 'motion', from: s.floor, to: s.moveTo ?? s.floor, endsAt }));
          break;
        case 'doors_opening':
          this.setPhase('doors_opening', t, endsAt);
          out.push(this.ev(t, { type: 'door', state: 'opening', floor: s.floor, endsAt }));
          break;
        case 'doors_open':
        case 'doors_closing':
          // Po usunięciu awarii drzwi się zamykają.
          this.setPhase('doors_closing', t, t + this.cfg().doorCloseMs);
          out.push(this.ev(t, { type: 'door', state: 'closing', floor: s.floor, endsAt: s.phaseEndsAt }));
          break;
        default:
          this.setPhase('idle', t, null);
          out.push(this.ev(t, { type: 'position', floor: s.floor, direction: s.direction }));
      }
      return out;
    }
    return [];
  }
}
