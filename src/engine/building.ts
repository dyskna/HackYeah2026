/**
 * Budynek = rdzeń (kolejka, przydział, ETA) + sterownik (tu: symulator).
 *
 * Pętla jest deterministyczna: czas podaje wywołujący (Durable Object podaje
 * Date.now(), testy podają czas wprost). Po restarcie `run(now)` odtwarza
 * zaległe przejścia w kolejności ich znaczników czasu, więc kabina nie
 * „przeskakuje” i kolejka się nie gubi.
 */
import type { BuildingConfig } from '../shared/config';
import type { ControllerEvent } from '../shared/events';
import type { CoreState, Direction } from '../shared/model';
import type { AppCallInput, CallResult, Notice } from './core';
import { Core, initialCoreState } from './core';
import type { SimState } from './simulator';
import { Simulator, initialSimState } from './simulator';

export interface BuildingSnapshot {
  core: CoreState;
  sim: SimState;
}

/** Wejścia panelu symulatora (w realnej instalacji: zdarzenia z adaptera). */
export type SimInput =
  | { type: 'hall_press'; floor: number; direction?: Direction | null; waiting?: number; dests?: number[] }
  | { type: 'car_press'; floor: number }
  | { type: 'enter'; count: number; dest: number }
  | { type: 'exit'; count: number }
  | { type: 'board_group'; callId: string; dest?: number }
  | { type: 'fault'; active: boolean; reason?: string }
  | { type: 'config'; patch: Partial<Omit<BuildingConfig, 'buildingId'>> };

const PRUNE_AFTER_MS = 10 * 60 * 1000;
const LOOP_GUARD = 200;

export class Building {
  core: Core;
  sim: Simulator;

  constructor(
    public state: BuildingSnapshot,
    newId?: () => string,
  ) {
    this.core = new Core(state.core, newId);
    this.sim = new Simulator(state.sim, () => this.state.core.config);
  }

  static create(config: BuildingConfig, now: number, newId?: () => string): Building {
    return new Building({ core: initialCoreState(config, now), sim: initialSimState(config, now) }, newId);
  }

  get config(): BuildingConfig {
    return this.state.core.config;
  }

  /** Przesuwa czas symulacji do `now`, przetwarzając wszystkie zaległe przejścia. */
  run(now: number): void {
    for (let i = 0; i < 100_000; i++) {
      const t = this.sim.nextTransitionAt();
      if (t === null || t > now) break;
      this.pump(this.sim.advance(t), t);
    }
    this.core.recompute(now);
  }

  /** Ktoś ogląda aplikację: ruch tła działa jeszcze przez `ms`. */
  keepAlive(now: number, ms = 10 * 60_000): void {
    this.run(now);
    this.sim.keepAmbientAlive(now, now + ms);
  }

  /** Najbliższy moment, w którym stan zmieni się bez udziału użytkownika. */
  nextWakeAt(): number | null {
    return this.sim.nextTransitionAt();
  }

  /** Zdarzenia sterownika → rdzeń, potem decyzje rdzenia → sterownik, aż do ustalenia. */
  private pump(events: ControllerEvent[], t: number): void {
    let queue = events;
    let changed = events.length > 0;
    for (let i = 0; i < LOOP_GUARD; i++) {
      for (const e of queue) this.core.apply(e);
      queue = [];
      for (const c of this.core.newlyArrived.splice(0)) {
        if (this.config.autoBoard && c.passengerCount) {
          queue.push(...this.sim.boardGroup(c.callId, c.passengerCount, this.defaultDest(c.floor), t));
        }
      }
      const cmd = this.core.decide();
      if (cmd) queue.push(...this.sim.command(cmd, t));
      if (queue.length === 0) break;
      changed = true;
    }
    if (changed) this.state.core.version += 1;
    this.core.recompute(t);
  }

  /** Cel grupy w symulacji: z pięter w dół na parter, z parteru na najwyższe piętro. */
  private defaultDest(floor: number): number {
    return floor > this.config.minFloor ? this.config.minFloor : this.config.maxFloor;
  }

  private touch(now: number): void {
    this.state.core.version += 1;
    this.pump([], now);
  }

  // ───────────────────────── operacje mieszkańca ─────────────────────────

  appCall(input: AppCallInput, now: number): CallResult {
    this.run(now);
    const r = this.core.appCall(input, now);
    if (r.ok && r.created) this.touch(now);
    return r;
  }

  updatePassengerCount(installationId: string, callId: string, count: number, now: number): CallResult {
    this.run(now);
    const r = this.core.updatePassengerCount(installationId, callId, count, now);
    if (r.ok) this.touch(now);
    return r;
  }

  cancel(installationId: string, callId: string, now: number): CallResult {
    this.run(now);
    const r = this.core.cancel(installationId, callId, now);
    if (r.ok) this.touch(now);
    return r;
  }

  // ───────────────────────── panel symulatora / adapter ─────────────────────────

  /** Zdarzenie z adaptera prawdziwego sterownika (ten sam format co symulator). */
  controllerEvent(e: ControllerEvent, now: number): void {
    this.run(now);
    this.pump([e], now);
  }

  simInput(input: SimInput, now: number): { ok: boolean; error?: string } {
    this.run(now);
    const cfg = this.config;
    const floorOk = (f: number) => Number.isInteger(f) && f >= cfg.minFloor && f <= cfg.maxFloor;
    let events: ControllerEvent[] = [];
    switch (input.type) {
      case 'hall_press': {
        if (!floorOk(input.floor)) return { ok: false, error: 'invalid_floor' };
        const dests = input.dests ?? Array.from({ length: input.waiting ?? 0 }, () => this.defaultDest(input.floor));
        if (!dests.every(floorOk)) return { ok: false, error: 'invalid_floor' };
        events = this.sim.pressHall(input.floor, cfg.directionalCalls ? (input.direction ?? null) : null, dests, now);
        break;
      }
      case 'car_press':
        if (!floorOk(input.floor)) return { ok: false, error: 'invalid_floor' };
        events = this.sim.pressCar(input.floor, now);
        break;
      case 'enter':
        if (!floorOk(input.dest) || !(input.count > 0)) return { ok: false, error: 'invalid_input' };
        events = this.sim.enter(input.count, input.dest, now);
        break;
      case 'exit':
        if (!(input.count > 0)) return { ok: false, error: 'invalid_input' };
        events = this.sim.exit(input.count, now);
        break;
      case 'board_group': {
        const c = this.state.core.calls.find((x) => x.callId === input.callId);
        if (!c || c.status !== 'arrived' || !c.passengerCount) return { ok: false, error: 'not_arrived' };
        const dest = input.dest ?? this.defaultDest(c.floor);
        if (!floorOk(dest)) return { ok: false, error: 'invalid_floor' };
        events = this.sim.boardGroup(c.callId, c.passengerCount, dest, now, true);
        break;
      }
      case 'fault':
        events = this.sim.setFault(input.active, input.reason ?? null, now);
        break;
      case 'config': {
        const { patch } = input;
        const next = { ...cfg, ...patch, buildingId: cfg.buildingId };
        const err = validateConfig(next);
        if (err) return { ok: false, error: err };
        this.state.core.config = next;
        if (patch.occupancyTelemetry !== undefined) events = this.sim.reportOccupancy(now);
        break;
      }
    }
    this.state.core.version += 1;
    this.pump(events, now);
    return { ok: true };
  }

  /** Komunikaty dla klientów (przyjęcie, dostępność, przyjazd…), opróżniane po odczycie. */
  drainNotices(): Notice[] {
    return this.core.notices.splice(0);
  }

  prune(now: number): void {
    this.core.prune(now, PRUNE_AFTER_MS);
  }
}

export function validateConfig(c: BuildingConfig): string | null {
  const posInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  if (!Number.isInteger(c.minFloor) || !Number.isInteger(c.maxFloor) || c.maxFloor <= c.minFloor) return 'invalid_floors';
  if (!posInt(c.capacity) || c.capacity > 50) return 'invalid_capacity';
  for (const k of ['travelPerFloorMs', 'doorOpenMs', 'doorDwellMs', 'doorCloseMs'] as const) {
    if (!posInt(c[k]) || c[k] > 120_000) return `invalid_${k}`;
  }
  if (!Number.isInteger(c.boardingDelayMs) || c.boardingDelayMs < 0 || c.boardingDelayMs >= c.doorDwellMs) return 'invalid_boardingDelayMs';
  return null;
}
