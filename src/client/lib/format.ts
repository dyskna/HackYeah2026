/**
 * Teksty po polsku: piętra, liczba osób, czas, opisy położenia kabiny.
 */
import type { EtaReason } from '../../shared/model';
import type { CarView } from '../../shared/protocol';

/** „P” albo numer piętra (tabliczki, przyciski, wyświetlacz). */
export function floorShort(f: number): string {
  return f === 0 ? 'P' : String(f);
}

/** „Parter” / „4. piętro”. */
export function floorName(f: number): string {
  return f === 0 ? 'Parter' : `${f}. piętro`;
}

/** „na parterze” / „na 4. piętrze”. */
export function floorAt(f: number): string {
  return f === 0 ? 'na parterze' : `na ${f}. piętrze`;
}

/** „między 7. a 6. piętrem”, „między parterem a 1. piętrem”, „między 1. piętrem a parterem”. */
function between(a: number, b: number): string {
  if (a === 0) return `między parterem a ${b}. piętrem`;
  if (b === 0) return `między ${a}. piętrem a parterem`;
  return `między ${a}. a ${b}. piętrem`;
}

/** 1 osoba, 2–4 osoby, 5+ osób (12–14 osób, 22–24 osoby). */
export function people(n: number): string {
  return `${n} ${peopleWord(n)}`;
}

export function peopleWord(n: number): string {
  if (n === 1) return 'osoba';
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'osoby' : 'osób';
}

/** Dopełniacz: „dla 1 osoby”, „dla 2 osób”. */
export function peopleGen(n: number): string {
  return `${n} ${n === 1 ? 'osoby' : 'osób'}`;
}

/**
 * Czas „około”: do 10 s dokładnie, dalej zaokrąglony do 5 s; od 100 s jako m:ss.
 * Zwraca tekst wyświetlacza i wersję do odczytu przez czytnik ekranu.
 */
export function etaDisplay(seconds: number): { led: string; spoken: string } {
  const s = Math.max(0, Math.round(seconds));
  const r = s <= 10 ? s : Math.round(s / 5) * 5;
  if (r < 100) return { led: `${r} s`, spoken: `${r} ${secondsWord(r)}` };
  const m = Math.floor(r / 60);
  const rest = r % 60;
  return {
    led: `${m}:${String(rest).padStart(2, '0')}`,
    spoken: rest ? `${m} min ${rest} ${secondsWord(rest)}` : `${m} min`,
  };
}

function secondsWord(n: number): string {
  if (n === 1) return 'sekunda';
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'sekundy' : 'sekund';
}

export function directionWord(dir: 'up' | 'down' | null): string {
  return dir === 'up' ? 'jedzie w górę' : dir === 'down' ? 'jedzie w dół' : 'stoi';
}

/** Zdanie o położeniu kabiny, np. „Między 7. a 6. piętrem, jedzie w dół.” */
export function carSentence(car: CarView): string {
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (car.phase === 'fault') {
    return car.targetFloor !== null && car.fault?.interruptedPhase === 'moving'
      ? `Zatrzymana ${between(car.floor, car.targetFloor)}.`
      : `Zatrzymana ${floorAt(car.floor)}.`;
  }
  if (car.phase === 'moving' && car.targetFloor !== null) {
    return `${cap(between(car.floor, car.targetFloor))}, ${directionWord(car.direction)}.`;
  }
  const doors =
    car.phase === 'doors_open' ? 'drzwi otwarte' :
    car.phase === 'doors_opening' ? 'drzwi się otwierają' :
    car.phase === 'doors_closing' ? 'drzwi się zamykają' : 'drzwi zamknięte';
  return `${cap(floorAt(car.floor))}, ${doors}.`;
}

export function occupancySentence(car: CarView, capacity: number): string {
  return car.occupancy === null ? 'Zajętość nieznana.' : `Zajęte ${car.occupancy} z ${capacity}.`;
}

/** Opis pod czasem przyjazdu: dlaczego prognoza jest taka, jaka jest. */
export function reasonText(reason: EtaReason, car: CarView): string {
  switch (reason.kind) {
    case 'stop_added':
      return `Dodano postój ${floorAt(reason.floor)}`;
    case 'waiting_for_space':
      return `Oczekiwanie na miejsce dla ${peopleGen(reason.count)}`;
    case 'arrived':
      return 'Drzwi otwarte';
    default:
      return car.phase === 'moving' ? `Kabina ${directionWord(car.direction)}` : `Kabina ${floorAt(car.floor)}`;
  }
}
