/**
 * Konfiguracja budynku i symulatora. Żadna z tych wartości nie jest wpisana
 * na sztywno w logice: silnik czyta je zawsze z obiektu BuildingConfig.
 */
export interface BuildingConfig {
  buildingId: string;
  name: string;
  address: string;
  /** Najniższe piętro (0 = parter). */
  minFloor: number;
  maxFloor: number;
  /** Pojemność kabiny w osobach. */
  capacity: number;
  /** Przejazd między sąsiednimi piętrami. */
  travelPerFloorMs: number;
  /** Otwieranie drzwi. */
  doorOpenMs: number;
  /** Postój z otwartymi drzwiami. */
  doorDwellMs: number;
  /** Zamykanie drzwi. */
  doorCloseMs: number;
  /** Czy instalacja rozróżnia wezwania „W górę” / „W dół”. */
  directionalCalls: boolean;
  /** Czy instalacja dostarcza dane o zajętości kabiny. */
  occupancyTelemetry: boolean;
  /** Symulator: grupa z aplikacji wsiada sama po przyjeździe. */
  autoBoard: boolean;
  /** Symulator: po jakim czasie od otwarcia drzwi pasażerowie wsiadają. */
  boardingDelayMs: number;
  /**
   * Symulator: ruch tła. Symulowani mieszkańcy co jakiś czas naciskają przyciski
   * na piętrach, dopóki ktoś ogląda aplikację (okno podtrzymania w Building).
   */
  ambientTraffic: boolean;
  /** Publiczne wejście demonstracyjne (przycisk demo i jeden wspólny kod QR) bez kodu od administratora. */
  publicDemo: boolean;
  ambientMinMs: number;
  ambientMaxMs: number;
}

/** Budynek demonstracyjny z dokumentacji: parter + piętra 1–10, kabina na 6 osób. */
export const DEMO_BUILDING: BuildingConfig = {
  buildingId: 'demo',
  name: 'Budynek demonstracyjny',
  address: '[adres budynku]',
  minFloor: 0,
  maxFloor: 10,
  capacity: 6,
  travelPerFloorMs: 3000,
  doorOpenMs: 2000,
  doorDwellMs: 5000,
  doorCloseMs: 2000,
  directionalCalls: false,
  occupancyTelemetry: true,
  autoBoard: true,
  boardingDelayMs: 2500,
  ambientTraffic: true,
  publicDemo: true,
  ambientMinMs: 15_000,
  ambientMaxMs: 40_000,
};

/** Token publicznego wejścia demo: kod `demo.wersja-demonstracyjna`. Działa tylko przy publicDemo. */
export const PUBLIC_DEMO_TOKEN = 'wersja-demonstracyjna';
export const PUBLIC_DEMO_CODE = `${DEMO_BUILDING.buildingId}.${PUBLIC_DEMO_TOKEN}`;

export const BUILDINGS: Record<string, BuildingConfig> = {
  [DEMO_BUILDING.buildingId]: DEMO_BUILDING,
};

/** Pełny cykl postoju: otwarcie + postój + zamknięcie. */
export function stopCycleMs(c: BuildingConfig): number {
  return c.doorOpenMs + c.doorDwellMs + c.doorCloseMs;
}
