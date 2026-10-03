import type { BuildingConfig } from './config';

export type Direction = 'up' | 'down';

/** Źródło zgłoszenia: „Aplikacja”, „Przycisk piętrowy”, „Przycisk kabinowy”. */
export type CallSource = 'app' | 'hall_button' | 'car_button';

export type CallStatus =
  /** Przyjęte; kabina obsługuje teraz coś w przeciwnym kierunku. „Wezwanie przyjęte”. */
  | 'accepted'
  /** Przypisane do najbliższego przejazdu, kabina zmierza ku piętru. „Winda jedzie do Ciebie”. */
  | 'assigned'
  /** Najbliższy przejazd nie pomieści grupy. „Oczekiwanie na miejsce”. */
  | 'waiting_for_space'
  /** Drzwi otwarte na piętrze w przydzielonym przejeździe. „Winda przyjechała”. */
  | 'arrived'
  /** Grupa wsiadła albo postój został obsłużony. */
  | 'completed'
  | 'cancelled'
  /** Drzwi zamknęły się bez wejścia grupy; przydział wygasł. */
  | 'expired';

export const ACTIVE_STATUSES: readonly CallStatus[] = ['accepted', 'assigned', 'waiting_for_space', 'arrived'];
export const PENDING_STATUSES: readonly CallStatus[] = ['accepted', 'assigned', 'waiting_for_space'];

/** Przewidywana z danych / potwierdzona odczytem na piętrze / nieznana (brak telemetrii). */
export type Availability = 'predicted' | 'confirmed' | 'unconfirmed';

export type EtaReason =
  | { kind: 'route' }
  | { kind: 'stop_added'; floor: number }
  | { kind: 'waiting_for_space'; count: number }
  | { kind: 'arrived' };

export interface Assignment {
  /** 0 = najbliższy przejazd przez piętro, 1 = kolejny itd. */
  tripIndex: number;
  seats: number | null;
  availability: Availability;
}

export interface Eta {
  /** Czas serwera, w którym drzwi mają się otworzyć na piętrze odbioru. */
  arrivalAt: number;
  computedAt: number;
  seconds: number;
  reason: EtaReason;
}

export interface Call {
  callId: string;
  requestId: string | null;
  buildingId: string;
  installationId: string | null;
  hardwareSourceId: string | null;
  eventId: string | null;
  source: CallSource;
  floor: number;
  direction: Direction | null;
  /** Liczba zadeklarowana w aplikacji; null = nieznana (zwykły przycisk). */
  passengerCount: number | null;
  status: CallStatus;
  assignment: Assignment | null;
  /** Czas przyjęcia. Nie zmienia się, gdy grupa czeka na kolejny przejazd. */
  createdAt: number;
  eta: Eta | null;
  updatedAt: number;
  /** Wewnętrzne: postoje przed odbiorem w ostatnim planie (do opisu zmiany ETA). */
  planStops?: number[];
  lastAddedStop?: number | null;
  /** Wewnętrzne: kabina już raz minęła grupę z braku miejsca w tym biegu. */
  passedForSpace?: boolean;
}

export type CarPhase = 'idle' | 'moving' | 'doors_opening' | 'doors_open' | 'doors_closing' | 'fault';

export interface CarState {
  phase: CarPhase;
  /** Bieżące piętro; w ruchu: piętro, z którego kabina wyjechała w tym odcinku. */
  floor: number;
  /** W ruchu: sąsiednie piętro, do którego zmierza. */
  targetFloor: number | null;
  direction: Direction | null;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  /** Zajętość z telemetrii; null = brak danych. */
  occupancy: number | null;
  /** Grupy, które przy bieżącym postoju nie zmieściły się w kabinie (czyszczone przy odjeździe). */
  noSpaceAtStop: string[] | null;
  fault: {
    since: number;
    reason: string;
    /** Faza przerwana awarią i postęp odcinka (0–1), jeśli kabina stanęła między piętrami. */
    interruptedPhase: CarPhase;
    progress: number;
  } | null;
}

export interface CoreState {
  version: number;
  config: BuildingConfig;
  car: CarState;
  calls: Call[];
  /** Ostatnio przetworzone identyfikatory zdarzeń sprzętowych (odrzucanie powtórzeń). */
  seenEventIds: string[];
}

export function isActive(c: Call): boolean {
  return ACTIVE_STATUSES.includes(c.status);
}

export function isPending(c: Call): boolean {
  return PENDING_STATUSES.includes(c.status);
}
