/**
 * Polityka ruchu kabiny i plan w przód.
 *
 * Ta sama funkcja `decide` steruje prawdziwym (symulowanym) ruchem i jest
 * używana do przewidywania trasy. Dzięki temu ETA wynika z dokładnie tych
 * decyzji, które kabina podejmie, dopóki nie przyjdzie nowa informacja.
 *
 * Zasady (model demonstracyjny, rozdz. 4 dokumentacji):
 * - kabina kończy bieżący odcinek do sąsiedniego piętra,
 * - kierunek nowego biegu wyznacza najstarsze zgłoszenie (wg czasu przyjęcia), które da się obsłużyć,
 * - kabina jedzie w danym kierunku, dopóki przed nią są zgłoszenia, i zawraca na najdalszym,
 * - po drodze zabiera tylko wezwania w kierunku jazdy (wezwanie z piętra = w dół, z parteru = w górę,
 *   gdy przyciski nie rozróżniają kierunku); cele kabinowe zawsze,
 * - grupa jest zabierana w całości albo wcale; gdy się nie mieści, piętro jest pomijane,
 * - przy pełnej kabinie postój tylko dla przycisku piętrowego jest pomijany.
 */
import type { BuildingConfig } from '../shared/config';
import { stopCycleMs } from '../shared/config';
import type { Direction } from '../shared/model';

export type DemandKind = 'car' | 'hall' | 'app';

export interface Demand {
  id: string;
  kind: DemandKind;
  floor: number;
  direction: Direction | null;
  /** Liczba osób; null = nieznana. */
  count: number | null;
  createdAt: number;
  /**
   * Tylko w planie: przewidywane wyjście grupy, która według planu wsiądzie.
   * Cel grupy jest nieznany, więc plan zakłada zjazd na parter (z parteru: na górę).
   * Taki postój nigdy nie jest traktowany jako potwierdzone zdarzenie.
   */
  predicted?: boolean;
}

/** Stan kabiny w punkcie decyzji (rzeczywisty albo przewidywany). */
export interface Hypo {
  floor: number;
  direction: Direction | null;
  /** Osoby w kabinie wg telemetrii; null = brak danych o zajętości. */
  occKnown: number | null;
  /** Osoby z grup, które według planu wsiądą. */
  occPlanned: number;
  demands: Demand[];
}

export type Action = { type: 'open' } | { type: 'go'; direction: Direction } | { type: 'idle' };

export interface FloorEvaluation {
  car: Demand[];
  apps: Demand[];
  halls: Demand[];
  /** Grupy na tym piętrze, które pasują kierunkiem, ale nie mieszczą się w kabinie. */
  noSpace: string[];
  /** Wolne miejsca po wyjściach i po wejściu grup (Infinity = brak danych). */
  freeAfter: number;
}

export interface Decision {
  action: Action;
  serve: Demand[];
  noSpace: string[];
}

function byAge(a: Demand, b: Demand): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function freeNow(h: Hypo, cfg: BuildingConfig): number {
  return h.occKnown === null ? Infinity : cfg.capacity - h.occKnown - h.occPlanned;
}

/** Czy zgłoszenie warto obrać za cel jazdy przy obecnym zapełnieniu. */
function targetWorthy(d: Demand, free: number): boolean {
  if (d.kind === 'car') return true;
  if (d.kind === 'hall') return free > 0;
  return (d.count ?? 0) <= free;
}

export function pickLead(h: Hypo, cfg: BuildingConfig): Demand | null {
  if (h.demands.length === 0) return null;
  const free = freeNow(h, cfg);
  const sorted = [...h.demands].sort(byAge);
  // Gdy nic nie da się teraz obsłużyć (np. pełna kabina bez znanych celów),
  // jedziemy do najstarszego zgłoszenia, żeby nie stać w miejscu.
  return sorted.find((d) => targetWorthy(d, free)) ?? sorted[0];
}

function beyond(floor: number, from: number, dir: Direction): boolean {
  return dir === 'up' ? floor > from : floor < from;
}

/** Co można obsłużyć na bieżącym piętrze. */
export function evaluateFloor(h: Hypo, cfg: BuildingConfig): FloorEvaluation {
  const here = h.demands.filter((d) => d.floor === h.floor);
  const car = here.filter((d) => d.kind === 'car');
  const realCarHere = car.some((d) => !d.predicted);
  const otherRealCarCalls = h.demands.some((d) => d.kind === 'car' && !d.predicted && d.floor !== h.floor);
  const plannedExit = car.filter((d) => d.predicted).reduce((n, d) => n + (d.count ?? 0), 0);

  // Najpierw wyjścia: gdy to ostatni znany cel kabinowy, znani pasażerowie wysiadają.
  const occAfterExit = h.occKnown === null ? null : realCarHere && !otherRealCarCalls ? 0 : h.occKnown;
  let free = occAfterExit === null ? Infinity : cfg.capacity - occAfterExit - (h.occPlanned - plannedExit);

  const freeForTargets = freeNow(h, cfg);
  const aheadExists = (dir: Direction) =>
    h.demands.some((d) => beyond(d.floor, h.floor, dir) && targetWorthy(d, freeForTargets));
  const dirOk = (d: Demand) =>
    d.direction === null || h.direction === null || d.direction === h.direction || !aheadExists(h.direction);

  const apps: Demand[] = [];
  const noSpace: string[] = [];
  for (const a of here.filter((d) => d.kind === 'app').sort(byAge)) {
    if (!dirOk(a)) continue;
    const n = a.count ?? 0;
    if (n <= free) {
      apps.push(a);
      free -= n;
    } else {
      noSpace.push(a.id);
    }
  }
  const halls = here.filter((d) => d.kind === 'hall' && dirOk(d));
  return { car, apps, halls, noSpace, freeAfter: free };
}

export function decide(h: Hypo, cfg: BuildingConfig): Decision {
  const ev = evaluateFloor(h, cfg);
  const hallWorth = ev.halls.length > 0 && ev.freeAfter > 0;
  if (ev.car.length > 0 || ev.apps.length > 0 || hallWorth) {
    return { action: { type: 'open' }, serve: [...ev.car, ...ev.apps, ...ev.halls], noSpace: ev.noSpace };
  }
  // Zbiorczo-kierunkowo: dopóki przed kabiną (w kierunku jazdy) jest coś do obsłużenia,
  // jedzie dalej; zawraca dopiero na najdalszym zgłoszeniu.
  if (h.direction !== null) {
    const free = freeNow(h, cfg);
    if (h.demands.some((d) => beyond(d.floor, h.floor, h.direction!) && targetWorthy(d, free))) {
      return { action: { type: 'go', direction: h.direction }, serve: [], noSpace: ev.noSpace };
    }
  }
  // Kierunek nowego biegu wyznacza najstarsze zgłoszenie.
  const lead = pickLead(h, cfg);
  if (!lead || lead.floor === h.floor) return { action: { type: 'idle' }, serve: [], noSpace: ev.noSpace };
  const direction: Direction = lead.floor > h.floor ? 'up' : 'down';
  return { action: { type: 'go', direction }, serve: [], noSpace: ev.noSpace };
}

export interface PlanBoarding {
  /** Czas otwarcia drzwi na piętrze odbioru. */
  at: number;
  /** Ile przejazdów przez piętro minie grupę z braku miejsca, zanim ją zabierze. */
  tripIndex: number;
  /** Piętra postojów przed odbiorem. */
  stopsBefore: number[];
}

export interface PlanStop {
  floor: number;
  openAt: number;
}

export interface PlanResult {
  boardings: Map<string, PlanBoarding>;
  noSpaceCount: Map<string, number>;
  stops: PlanStop[];
  /** false, gdy plan zatrzymał się z niezałatwionymi zgłoszeniami. */
  complete: boolean;
}

export interface PlanStart {
  t0: number;
  hypo: Hypo;
  /** Grupy, które już raz nie zmieściły się w tym postoju. */
  initialNoSpace: string[];
  /** Czy w pierwszym punkcie decyzji kabina właśnie dojeżdża do piętra. */
  freshArrival: boolean;
  /** Drzwi już się otwierają: pierwszy krok to postój, otwarcie o `t0`. */
  forcedOpenAt: number | null;
}

const MAX_STEPS = 2000;

/** Przewidywany postój, na którym grupa z planu wysiądzie (cel nieznany → parter / góra). */
export function predictedDrop(d: Demand, at: number, cfg: BuildingConfig): Demand {
  return {
    id: `drop:${d.id}`,
    kind: 'car',
    floor: d.floor > cfg.minFloor ? cfg.minFloor : cfg.maxFloor,
    direction: null,
    count: d.count,
    createdAt: at,
    predicted: true,
  };
}

export function plan(start: PlanStart, cfg: BuildingConfig): PlanResult {
  const h: Hypo = { ...start.hypo, demands: [...start.hypo.demands] };
  const boardings = new Map<string, PlanBoarding>();
  const noSpaceCount = new Map<string, number>();
  const stops: PlanStop[] = [];
  const bump = (ids: string[]) => ids.forEach((id) => noSpaceCount.set(id, (noSpaceCount.get(id) ?? 0) + 1));
  bump(start.initialNoSpace);

  let t = start.t0;
  let fresh = start.freshArrival;

  const doStop = (serve: Demand[], openAt: number) => {
    const servedIds = new Set(serve.map((d) => d.id));
    h.demands = h.demands.filter((d) => !servedIds.has(d.id));
    const realCar = (d: Demand) => d.kind === 'car' && !d.predicted;
    if (serve.some(realCar) && !h.demands.some(realCar) && h.occKnown !== null) h.occKnown = 0;
    for (const d of serve) {
      if (d.kind === 'car' && d.predicted) h.occPlanned = Math.max(0, h.occPlanned - (d.count ?? 0));
    }
    for (const d of serve) {
      if (d.kind !== 'app') continue;
      boardings.set(d.id, {
        at: openAt,
        tripIndex: noSpaceCount.get(d.id) ?? 0,
        stopsBefore: stops.map((s) => s.floor),
      });
      h.occPlanned += d.count ?? 0;
      h.demands.push(predictedDrop(d, openAt, cfg));
    }
    stops.push({ floor: h.floor, openAt });
  };

  if (start.forcedOpenAt !== null) {
    const ev = evaluateFloor(h, cfg);
    bump(ev.noSpace);
    doStop([...ev.car, ...ev.apps, ...ev.halls], start.forcedOpenAt);
    t = start.forcedOpenAt + cfg.doorDwellMs + cfg.doorCloseMs;
    fresh = false;
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    if (h.demands.length === 0) return { boardings, noSpaceCount, stops, complete: true };
    const d = decide(h, cfg);
    if (fresh) bump(d.noSpace);
    if (d.action.type === 'open') {
      doStop(d.serve, t + cfg.doorOpenMs);
      t += stopCycleMs(cfg);
      fresh = false;
    } else if (d.action.type === 'go') {
      const dir = d.action.direction;
      if (h.direction !== null && h.direction !== dir) {
        // Koniec biegu kabiny: pasażerowie bez znanego celu (np. dodani w panelu) wysiedli.
        if (!h.demands.some((x) => x.kind === 'car' && !x.predicted) && h.occKnown !== null) h.occKnown = 0;
      }
      h.direction = dir;
      h.floor += dir === 'up' ? 1 : -1;
      t += cfg.travelPerFloorMs;
      fresh = true;
    } else {
      break;
    }
  }
  return { boardings, noSpaceCount, stops, complete: h.demands.length === 0 };
}
