/**
 * Rdzeń: wspólna kolejka, przydział grup i ETA.
 *
 * Stan zmieniają wyłącznie zdarzenia sterownika (ControllerEvent) i operacje
 * mieszkańców (wezwanie, zmiana liczby osób, anulowanie). Stan jest zwykłym
 * obiektem JSON, więc Durable Object zapisuje go w całości.
 */
import type { BuildingConfig } from '../shared/config';
import type { ControllerCommand, ControllerEvent } from '../shared/events';
import type { Availability, Call, CallStatus, CoreState, Direction } from '../shared/model';
import { isActive, isPending } from '../shared/model';
import type { Demand, Hypo, PlanStart } from './policy';
import { decide, evaluateFloor, plan, predictedDrop } from './policy';

export interface AppCallInput {
  requestId: string;
  installationId: string;
  floor: number;
  passengerCount: number;
  direction?: Direction | null;
}

export type CallError =
  | 'fault'
  | 'invalid_request'
  | 'invalid_floor'
  | 'invalid_count'
  | 'group_too_large'
  | 'direction_required'
  | 'invalid_direction'
  | 'active_call_exists'
  | 'not_found'
  | 'forbidden'
  | 'not_modifiable';

export type CallResult =
  | { ok: true; created: boolean; call: Call }
  | { ok: false; error: CallError; call?: Call };

export type NoticeKind =
  | 'call_accepted'
  | 'availability_changed'
  | 'arrived'
  | 'expired'
  | 'completed'
  | 'cancelled'
  | 'fault'
  | 'fault_cleared';

export interface Notice {
  kind: NoticeKind;
  callId: string | null;
  installationId: string | null;
}

const SEEN_EVENTS_LIMIT = 500;

export function initialCoreState(config: BuildingConfig, now: number): CoreState {
  return {
    version: 1,
    config,
    car: {
      phase: 'idle',
      floor: config.minFloor,
      targetFloor: null,
      direction: null,
      phaseStartedAt: now,
      phaseEndsAt: null,
      occupancy: config.occupancyTelemetry ? 0 : null,
      noSpaceAtStop: null,
      fault: null,
    },
    calls: [],
    seenEventIds: [],
  };
}

export class Core {
  notices: Notice[] = [];
  /** Grupy, które właśnie dostały „Winda przyjechała” (symulator może je wsadzić). */
  newlyArrived: Call[] = [];

  constructor(
    public s: CoreState,
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  get cfg(): BuildingConfig {
    return this.s.config;
  }

  // ───────────────────────── zdarzenia sterownika ─────────────────────────

  /** Zwraca false dla powtórzonego zdarzenia. */
  apply(e: ControllerEvent): boolean {
    if (this.s.seenEventIds.includes(e.eventId)) return false;
    this.s.seenEventIds.push(e.eventId);
    if (this.s.seenEventIds.length > SEEN_EVENTS_LIMIT) this.s.seenEventIds.splice(0, this.s.seenEventIds.length - SEEN_EVENTS_LIMIT);

    const car = this.s.car;
    switch (e.type) {
      case 'hall_call': {
        if (!this.validFloor(e.floor)) return true;
        const direction = this.cfg.directionalCalls ? e.direction : null;
        const dup = this.s.calls.find(
          (c) => c.source === 'hall_button' && isPending(c) && c.floor === e.floor && c.direction === direction,
        );
        if (!dup) this.addHardwareCall('hall_button', e.floor, direction, e);
        break;
      }
      case 'car_call': {
        if (!this.validFloor(e.floor)) return true;
        const dup = this.s.calls.find((c) => c.source === 'car_button' && isPending(c) && c.floor === e.floor);
        if (!dup) this.addHardwareCall('car_button', e.floor, null, e);
        break;
      }
      case 'motion':
        car.phase = 'moving';
        car.floor = e.from;
        car.targetFloor = e.to;
        car.direction = e.to > e.from ? 'up' : 'down';
        car.phaseEndsAt = e.endsAt;
        // Początek liczony od końca odcinka: po wznowieniu z awarii kabina nie „skacze”.
        car.phaseStartedAt = e.endsAt - this.cfg.travelPerFloorMs;
        car.noSpaceAtStop = null;
        break;
      case 'position':
        car.phase = 'idle';
        car.floor = e.floor;
        car.targetFloor = null;
        car.direction = e.direction;
        car.phaseStartedAt = e.at;
        car.phaseEndsAt = null;
        car.noSpaceAtStop = null;
        break;
      case 'door':
        this.applyDoor(e.state, e.floor, e.at, e.endsAt);
        break;
      case 'occupancy':
        car.occupancy = this.cfg.occupancyTelemetry ? e.count : null;
        break;
      case 'passengers':
        if (e.boardedCallId) {
          const c = this.s.calls.find((x) => x.callId === e.boardedCallId);
          if (c && c.status === 'arrived') this.setStatus(c, 'completed', e.at);
        }
        break;
      case 'fault':
        if (e.active && !car.fault) {
          const total = (car.phaseEndsAt ?? e.at) - car.phaseStartedAt;
          car.fault = {
            since: e.at,
            reason: e.reason ?? 'Awaria',
            interruptedPhase: car.phase,
            progress: car.phase === 'moving' && total > 0 ? Math.min(1, Math.max(0, (e.at - car.phaseStartedAt) / total)) : 0,
          };
          car.phase = 'fault';
          this.notice('fault', null);
        } else if (!e.active && car.fault) {
          car.phase = car.fault.interruptedPhase;
          car.fault = null;
          this.notice('fault_cleared', null);
        }
        break;
    }
    return true;
  }

  private applyDoor(state: 'opening' | 'open' | 'closing' | 'closed', floor: number, at: number, endsAt: number | null) {
    const car = this.s.car;
    car.floor = floor;
    car.targetFloor = null;
    car.phaseStartedAt = at;
    car.phaseEndsAt = endsAt;
    if (state === 'opening') {
      car.phase = 'doors_opening';
    } else if (state === 'open') {
      car.phase = 'doors_open';
      // Cele kabinowe na tym piętrze są obsłużone (pasażerowie wysiedli).
      for (const c of this.s.calls) {
        if (c.source === 'car_button' && isPending(c) && c.floor === floor) this.setStatus(c, 'completed', at);
      }
      const ev = evaluateFloor(this.hypoAt(floor, car.direction), this.cfg);
      for (const d of ev.halls) {
        const c = this.byId(d.id);
        if (c) this.setStatus(c, 'completed', at);
      }
      for (const d of ev.apps) {
        const c = this.byId(d.id);
        if (c) this.markArrived(c, at);
      }
      car.noSpaceAtStop = ev.noSpace;
      this.markPassed(ev.noSpace);
    } else if (state === 'closing') {
      car.phase = 'doors_closing';
      // Grupa nie wsiadła przed zamknięciem drzwi: przydział miejsc wygasa.
      for (const c of this.s.calls) {
        if (c.status === 'arrived' && c.floor === floor) {
          this.setStatus(c, 'expired', at);
          c.eta = null;
          c.assignment = null;
          this.notice('expired', c);
        }
      }
    } else {
      car.phase = 'idle';
    }
  }

  private markArrived(c: Call, at: number) {
    this.setStatus(c, 'arrived', at);
    c.assignment = {
      tripIndex: 0,
      seats: c.passengerCount,
      availability: this.s.car.occupancy === null ? 'unconfirmed' : 'confirmed',
    };
    c.eta = { arrivalAt: at, computedAt: at, seconds: 0, reason: { kind: 'arrived' } };
    this.newlyArrived.push(c);
    this.notice('arrived', c);
  }

  /** Grupa zgłosiła się, gdy drzwi na jej piętrze są już otwarte. */
  private boardIfDoorsOpen(at: number) {
    const car = this.s.car;
    if (car.phase !== 'doors_open') return;
    const ev = evaluateFloor(this.hypoAt(car.floor, car.direction), this.cfg);
    for (const d of ev.apps) {
      const c = this.byId(d.id);
      if (c && isPending(c)) this.markArrived(c, at);
    }
  }

  // ───────────────────────── operacje mieszkańca ─────────────────────────

  appCall(input: AppCallInput, now: number): CallResult {
    if (!input.requestId || typeof input.requestId !== 'string' || input.requestId.length > 100) {
      return { ok: false, error: 'invalid_request' };
    }
    // Ponowienie z tym samym requestId zwraca istniejące zgłoszenie.
    const same = this.s.calls.find((c) => c.installationId === input.installationId && c.requestId === input.requestId);
    if (same) return { ok: true, created: false, call: same };

    if (this.s.car.phase === 'fault') return { ok: false, error: 'fault' };
    const err = this.validateGroup(input.floor, input.passengerCount);
    if (err) return { ok: false, error: err };

    let direction: Direction | null = null;
    if (this.cfg.directionalCalls) {
      if (input.direction !== 'up' && input.direction !== 'down') return { ok: false, error: 'direction_required' };
      if ((input.direction === 'up' && input.floor >= this.cfg.maxFloor) || (input.direction === 'down' && input.floor <= this.cfg.minFloor)) {
        return { ok: false, error: 'invalid_direction' };
      }
      direction = input.direction;
    }

    const existing = this.s.calls.find((c) => c.installationId === input.installationId && isActive(c));
    if (existing) return { ok: false, error: 'active_call_exists', call: existing };

    const call: Call = {
      callId: this.newId(),
      requestId: input.requestId,
      buildingId: this.cfg.buildingId,
      installationId: input.installationId,
      hardwareSourceId: null,
      eventId: null,
      source: 'app',
      floor: input.floor,
      direction,
      passengerCount: input.passengerCount,
      status: 'accepted',
      assignment: null,
      createdAt: now,
      eta: null,
      updatedAt: now,
    };
    this.s.calls.push(call);
    this.notice('call_accepted', call);
    this.boardIfDoorsOpen(now);
    return { ok: true, created: true, call };
  }

  updatePassengerCount(installationId: string, callId: string, count: number, now: number): CallResult {
    const c = this.byId(callId);
    if (!c) return { ok: false, error: 'not_found' };
    if (c.installationId !== installationId) return { ok: false, error: 'forbidden' };
    if (!isPending(c)) return { ok: false, error: 'not_modifiable', call: c };
    const err = this.validateGroup(c.floor, count);
    if (err) return { ok: false, error: err, call: c };
    c.passengerCount = count;
    c.updatedAt = now;
    this.boardIfDoorsOpen(now);
    return { ok: true, created: false, call: c };
  }

  /** Usuwa tylko własne zgłoszenie. Postoje z innych zgłoszeń i cele kabinowe zostają. */
  cancel(installationId: string, callId: string, now: number): CallResult {
    const c = this.byId(callId);
    if (!c) return { ok: false, error: 'not_found' };
    if (c.installationId !== installationId) return { ok: false, error: 'forbidden' };
    if (!isActive(c)) return { ok: false, error: 'not_modifiable', call: c };
    this.setStatus(c, 'cancelled', now);
    c.eta = null;
    c.assignment = null;
    this.notice('cancelled', c);
    return { ok: true, created: false, call: c };
  }

  private validateGroup(floor: number, count: number): CallError | null {
    if (!this.validFloor(floor)) return 'invalid_floor';
    if (!Number.isInteger(count) || count < 1) return 'invalid_count';
    if (count > this.cfg.capacity) return 'group_too_large';
    return null;
  }

  // ───────────────────────── decyzje i prognoza ─────────────────────────

  /** Polecenie dla sterownika, gdy kabina stoi w punkcie decyzji. */
  decide(): ControllerCommand | null {
    const car = this.s.car;
    if (car.phase !== 'idle') return null;
    const d = decide(this.hypoAt(car.floor, car.direction), this.cfg);
    this.markPassed(d.noSpace);
    if (d.action.type === 'open') return { type: 'open' };
    if (d.action.type === 'go') return { type: 'go', direction: d.action.direction };
    return null;
  }

  /** Przelicza przydział, status i ETA wszystkich oczekujących grup. */
  recompute(now: number): void {
    const car = this.s.car;
    const apps = this.s.calls.filter((c) => c.source === 'app' && isPending(c));
    if (car.phase === 'fault') {
      for (const c of apps) c.eta = null;
      return;
    }
    const result = plan(this.planStart(now), this.cfg);
    const availability: Availability = car.occupancy === null ? 'unconfirmed' : 'predicted';

    for (const c of apps) {
      const before = { status: c.status, availability: c.assignment?.availability };
      const b = result.boardings.get(c.callId);
      if (!b) {
        c.status = 'waiting_for_space';
        c.assignment = { tripIndex: result.noSpaceCount.get(c.callId) ?? 0, seats: c.passengerCount, availability };
        c.eta = null;
      } else {
        // Kabina, która najpierw minie piętro i zawróci dalej, jeszcze nie „jedzie do Ciebie”.
        const dir = car.direction;
        const passesFirst = dir !== null && b.stopsBefore.some((f) => (dir === 'up' ? f > c.floor : f < c.floor));
        const heading = this.headingTowards(c.floor) && !passesFirst;
        // Kabina minęła grupę z braku miejsca i jeszcze nie zawróciła: grupa czeka na kolejny przejazd.
        const passed = !!c.passedForSpace && !heading;
        if (c.passedForSpace && heading && b.tripIndex === 0) c.passedForSpace = false;
        const waiting = b.tripIndex > 0 || passed;
        c.status = waiting ? 'waiting_for_space' : heading ? 'assigned' : 'accepted';
        c.assignment = { tripIndex: b.tripIndex + (passed ? 1 : 0), seats: c.passengerCount, availability };

        if (c.planStops !== undefined) {
          const added = b.stopsBefore.filter((f) => !c.planStops!.includes(f));
          if (added.length > 0) c.lastAddedStop = added[added.length - 1];
        }
        if (c.lastAddedStop != null && !b.stopsBefore.includes(c.lastAddedStop)) c.lastAddedStop = null;
        c.planStops = b.stopsBefore;

        c.eta = {
          arrivalAt: b.at,
          computedAt: now,
          seconds: Math.max(0, Math.ceil((b.at - now) / 1000)),
          reason: waiting
            ? { kind: 'waiting_for_space', count: c.passengerCount ?? 0 }
            : c.lastAddedStop != null
              ? { kind: 'stop_added', floor: c.lastAddedStop }
              : { kind: 'route' },
        };
      }
      const wasWaiting = before.status === 'waiting_for_space';
      const isWaiting = c.status === 'waiting_for_space';
      if (wasWaiting !== isWaiting || before.availability !== c.assignment?.availability) {
        c.updatedAt = now;
        if (before.availability !== undefined) this.notice('availability_changed', c);
      }
    }
  }

  private planStart(now: number): PlanStart {
    const car = this.s.car;
    const base = this.hypoAt(car.floor, car.direction);
    switch (car.phase) {
      case 'moving':
        return { t0: car.phaseEndsAt ?? now, hypo: { ...base, floor: car.targetFloor ?? car.floor }, initialNoSpace: [], freshArrival: true, forcedOpenAt: null };
      case 'doors_opening':
        return { t0: car.phaseEndsAt ?? now, hypo: base, initialNoSpace: [], freshArrival: false, forcedOpenAt: car.phaseEndsAt ?? now };
      case 'doors_open': {
        // Grupy z „Winda przyjechała” wsiadają teraz; w planie zajmują miejsca do przewidywanego wyjścia.
        const boarding = this.s.calls.filter((c) => c.status === 'arrived' && c.floor === car.floor);
        const drops = boarding.map((c) =>
          predictedDrop({ id: c.callId, kind: 'app', floor: c.floor, direction: null, count: c.passengerCount, createdAt: c.createdAt }, now, this.cfg),
        );
        return {
          t0: (car.phaseEndsAt ?? now) + this.cfg.doorCloseMs,
          hypo: {
            ...base,
            occPlanned: boarding.reduce((n, c) => n + (c.passengerCount ?? 0), 0),
            demands: [...base.demands, ...drops],
          },
          initialNoSpace: car.noSpaceAtStop ?? [],
          freshArrival: false,
          forcedOpenAt: null,
        };
      }
      case 'doors_closing':
        return { t0: car.phaseEndsAt ?? now, hypo: base, initialNoSpace: car.noSpaceAtStop ?? [], freshArrival: false, forcedOpenAt: null };
      default: {
        const stoppedHere = car.noSpaceAtStop !== null;
        return { t0: now, hypo: base, initialNoSpace: car.noSpaceAtStop ?? [], freshArrival: !stoppedHere, forcedOpenAt: null };
      }
    }
  }

  private headingTowards(floor: number): boolean {
    const car = this.s.car;
    const ref = car.phase === 'moving' && car.targetFloor !== null ? car.targetFloor : car.floor;
    if (car.direction === null || ref === floor) return true;
    return car.direction === 'up' ? floor > ref : floor < ref;
  }

  private markPassed(ids: string[]) {
    for (const id of ids) {
      const c = this.byId(id);
      if (c && isPending(c)) c.passedForSpace = true;
    }
  }

  /**
   * Przyciski bez kierunku: w bloku mieszkalnym wezwanie z piętra to zwykle zjazd
   * na parter, a z parteru – wjazd. Tylko do planowania trasy; zgłoszenie nie ma kierunku.
   */
  private impliedDirection(floor: number): Direction {
    return floor === this.cfg.minFloor ? 'up' : 'down';
  }

  demands(): Demand[] {
    return this.s.calls.filter(isPending).map((c) => ({
      id: c.callId,
      kind: c.source === 'app' ? 'app' : c.source === 'hall_button' ? 'hall' : 'car',
      floor: c.floor,
      direction: c.source === 'car_button' ? null : (c.direction ?? this.impliedDirection(c.floor)),
      count: c.passengerCount,
      createdAt: c.createdAt,
    }));
  }

  private hypoAt(floor: number, direction: Direction | null): Hypo {
    return { floor, direction, occKnown: this.s.car.occupancy, occPlanned: 0, demands: this.demands() };
  }

  // ───────────────────────── pomocnicze ─────────────────────────

  private addHardwareCall(source: 'hall_button' | 'car_button', floor: number, direction: Direction | null, e: ControllerEvent) {
    this.s.calls.push({
      callId: this.newId(),
      requestId: null,
      buildingId: this.cfg.buildingId,
      installationId: null,
      hardwareSourceId: e.sourceId,
      eventId: e.eventId,
      source,
      floor,
      direction,
      // Zwykły przycisk nie mówi, ile osób czeka. Nigdy nie zakładamy „1 osoba”.
      passengerCount: null,
      status: 'accepted',
      assignment: null,
      createdAt: e.at,
      eta: null,
      updatedAt: e.at,
    });
  }

  private setStatus(c: Call, status: CallStatus, at: number) {
    c.status = status;
    c.updatedAt = at;
    if (status === 'completed' && c.source === 'app') this.notice('completed', c);
  }

  private notice(kind: NoticeKind, c: Call | null) {
    this.notices.push({ kind, callId: c?.callId ?? null, installationId: c?.installationId ?? null });
  }

  private byId(id: string): Call | undefined {
    return this.s.calls.find((c) => c.callId === id);
  }

  private validFloor(f: number): boolean {
    return Number.isInteger(f) && f >= this.cfg.minFloor && f <= this.cfg.maxFloor;
  }

  /** Usuwa zakończone zgłoszenia starsze niż `maxAgeMs` (stan nie rośnie bez końca). */
  prune(now: number, maxAgeMs: number): void {
    this.s.calls = this.s.calls.filter((c) => isActive(c) || now - c.updatedAt < maxAgeMs);
  }
}
