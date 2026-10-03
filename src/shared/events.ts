import type { Direction } from './model';

/**
 * Zdarzenia od sterownika windy. Ten sam format wysyła symulator i adapter
 * prawdziwego sterownika, więc silnik nie wie, skąd zdarzenie przyszło.
 */
export type ControllerEvent = { eventId: string; at: number; sourceId: string } & ControllerEventBody;

export type ControllerEventBody =
  /** Przycisk na piętrze. Nie niesie liczby osób. */
  | { type: 'hall_call'; floor: number; direction: Direction | null }
  /** Przycisk w kabinie: obowiązkowy postój. */
  | { type: 'car_call'; floor: number }
  /** Kabina rusza w odcinek do sąsiedniego piętra. */
  | { type: 'motion'; from: number; to: number; endsAt: number }
  /** Kabina dojechała do piętra i czeka na decyzję (zatrzymać / jechać dalej). */
  | { type: 'position'; floor: number; direction: Direction | null }
  | { type: 'door'; state: 'opening' | 'open' | 'closing' | 'closed'; floor: number; endsAt: number | null }
  /** Telemetria zajętości; null = instalacja nie dostarcza danych. */
  | { type: 'occupancy'; count: number | null }
  /** Wejścia i wyjścia na piętrze; boardedCallId potwierdza wejście grupy z aplikacji. */
  | { type: 'passengers'; floor: number; entered: number; exited: number; boardedCallId: string | null }
  | { type: 'fault'; active: boolean; reason: string | null };

/** Polecenia dla sterownika. W demo wykonuje je symulator. */
export type ControllerCommand =
  | { type: 'go'; direction: Direction }
  | { type: 'open' };
