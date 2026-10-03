/**
 * Położenie kabiny odtwarzane ze stanu serwera. Klient niczego nie decyduje:
 * interpoluje tylko odcinek, który serwer opisał znacznikami czasu.
 */
import type { CarView } from '../../shared/protocol';

/** Ułamkowe piętro kabiny w chwili `serverNow` (np. 6.5 = w połowie między 6. a 7.). */
export function positionAt(car: CarView, serverNow: number, smooth = true): number {
  const target = car.targetFloor;
  if (car.phase === 'fault' && car.fault && car.fault.interruptedPhase === 'moving' && target !== null) {
    return smooth ? car.floor + (target - car.floor) * car.fault.progress : car.floor;
  }
  if (car.phase !== 'moving' || target === null || car.phaseEndsAt === null) return car.floor;
  if (!smooth) return car.floor;
  const total = car.phaseEndsAt - car.phaseStartedAt;
  const p = total > 0 ? Math.min(1, Math.max(0, (serverNow - car.phaseStartedAt) / total)) : 1;
  return car.floor + (target - car.floor) * p;
}

/** Piętro pokazywane na wyświetlaczu: w ruchu piętro, do którego kabina zmierza. */
export function displayFloor(car: CarView): number {
  return car.phase === 'moving' && car.targetFloor !== null ? car.targetFloor : car.floor;
}
