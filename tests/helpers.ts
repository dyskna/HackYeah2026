import type { BuildingConfig } from '../src/shared/config';
import { DEMO_BUILDING } from '../src/shared/config';
import { Building } from '../src/engine/building';
import type { Call } from '../src/shared/model';

/** Budynek demo z deterministycznymi identyfikatorami i opcjonalnymi zmianami konfiguracji. */
export function demo(overrides: Partial<BuildingConfig> = {}, now = 0): Building {
  let n = 0;
  return Building.create({ ...DEMO_BUILDING, ambientTraffic: false, ...overrides }, now, () => `id-${++n}`);
}

let req = 0;
export function call(b: Building, installationId: string, floor: number, passengerCount: number, now: number): Call {
  const r = b.appCall({ requestId: `req-${++req}`, installationId, floor, passengerCount }, now);
  if (!r.ok) throw new Error(`wezwanie odrzucone: ${r.error}`);
  return r.call;
}

export function get(b: Building, callId: string): Call {
  const c = b.state.core.calls.find((x) => x.callId === callId);
  if (!c) throw new Error(`brak zgłoszenia ${callId}`);
  return c;
}
