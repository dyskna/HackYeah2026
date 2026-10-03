/**
 * Projekcje stanu dla klientów. Mieszkaniec widzi windę, postoje ze źródłem
 * i wyłącznie własne zgłoszenie. Cudze identyfikatory, nazwy i liczebność grup
 * nie opuszczają serwera.
 */
import type { BuildingConfig } from '../shared/config';
import type { Call, CoreState } from '../shared/model';
import { isActive, isPending } from '../shared/model';
import type { BuildingInfo, LampsView, MyCallView, ResidentView, StopSource, StopView } from '../shared/protocol';

export function buildingInfo(c: BuildingConfig): BuildingInfo {
  return {
    id: c.buildingId,
    name: c.name,
    address: c.address,
    minFloor: c.minFloor,
    maxFloor: c.maxFloor,
    capacity: c.capacity,
    directionalCalls: c.directionalCalls,
    occupancyTelemetry: c.occupancyTelemetry,
    travelPerFloorMs: c.travelPerFloorMs,
    doorOpenMs: c.doorOpenMs,
    doorCloseMs: c.doorCloseMs,
  };
}

export function myCallView(c: Call): MyCallView {
  return {
    callId: c.callId,
    requestId: c.requestId,
    floor: c.floor,
    direction: c.direction,
    passengerCount: c.passengerCount,
    status: c.status,
    assignment: c.assignment,
    createdAt: c.createdAt,
    eta: c.eta,
  };
}

export function residentView(s: CoreState, installationId: string | null, now: number): ResidentView {
  const mine = installationId ? s.calls.find((c) => c.installationId === installationId && isActive(c)) ?? null : null;

  // Postoje: zgłoszenia, które kabina obsłuży. Grupa czekająca na kolejny przejazd nie jest postojem.
  const byFloor = new Map<number, StopView>();
  for (const c of s.calls) {
    if (!isPending(c)) continue;
    if (c.source === 'app' && c.status === 'waiting_for_space') continue;
    const source: StopSource = c.source === 'app' ? 'app' : c.source === 'hall_button' ? 'hall' : 'car';
    const stop = byFloor.get(c.floor) ?? { floor: c.floor, sources: [], mine: false };
    if (!stop.sources.includes(source)) stop.sources.push(source);
    if (mine && c.callId === mine.callId) stop.mine = true;
    byFloor.set(c.floor, stop);
  }

  let lamps: LampsView | null = null;
  const occ = s.car.occupancy;
  if (occ !== null) {
    const cap = s.config.capacity;
    const occupied = Math.min(cap, occ);
    const reserved =
      mine && (mine.status === 'assigned' || mine.status === 'arrived') && mine.passengerCount ? mine.passengerCount : 0;
    const mineSeats = Math.min(reserved, cap - occupied);
    lamps = { occupied, mine: mineSeats, free: cap - occupied - mineSeats };
  }

  return {
    version: s.version,
    serverNow: now,
    building: buildingInfo(s.config),
    car: {
      phase: s.car.phase,
      floor: s.car.floor,
      targetFloor: s.car.targetFloor,
      direction: s.car.direction,
      phaseStartedAt: s.car.phaseStartedAt,
      phaseEndsAt: s.car.phaseEndsAt,
      occupancy: s.car.occupancy,
      fault: s.car.fault ? { ...s.car.fault } : null,
    },
    lamps,
    stops: [...byFloor.values()].sort((a, b) => b.floor - a.floor),
    myCall: mine ? myCallView(mine) : null,
  };
}
