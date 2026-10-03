import { describe, expect, it } from 'vitest';
import { Building } from '../src/engine/building';
import { call, demo, get } from './helpers';

describe('przykład z rozdz. 4: grupa 2 osób z 4. piętra i przycisk na 2. piętrze', () => {
  // Przyciski z kierunkiem: na 2. i 4. czekają osoby jadące w górę, więc kabina staje najpierw na 2.
  it('przycisk dodaje postój, a gdy po nim zostaje 1 miejsce, grupa czeka na kolejny przejazd', () => {
    const b = demo({ directionalCalls: true });
    const r = b.appCall({ requestId: 'ch4', installationId: 'A', floor: 4, passengerCount: 2, direction: 'up' }, 0);
    if (!r.ok) throw new Error(r.error);
    const g = r.call;
    expect(get(b, g.callId)).toMatchObject({
      status: 'assigned',
      assignment: { tripIndex: 0, seats: 2, availability: 'predicted' },
      eta: { seconds: 14 },
    });

    // Mieszkaniec naciska przycisk na 2. piętrze. Serwer nie zna liczby osób (czeka 5, jadą na 8.).
    b.simInput({ type: 'hall_press', floor: 2, direction: 'up', dests: [8, 8, 8, 8, 8] }, 0);
    const hall = b.state.core.calls.find((c) => c.source === 'hall_button')!;
    expect(hall.passengerCount).toBeNull();
    expect(get(b, g.callId).eta).toMatchObject({ seconds: 23, reason: { kind: 'stop_added', floor: 2 } });

    // Postój na 2.: drzwi otwarte o 8 000, wsiadanie o 10 500 → zajętość 5 z 6.
    b.run(10_500);
    expect(b.state.core.car.occupancy).toBe(5);
    const waiting = get(b, g.callId);
    expect(waiting).toMatchObject({
      status: 'waiting_for_space',
      createdAt: 0, // pierwotny czas przyjęcia zostaje
      assignment: { tripIndex: 1, seats: 2 },
      eta: { reason: { kind: 'waiting_for_space', count: 2 } },
    });
    // ETA dotyczy przejazdu, do którego grupa jest przypisana:
    // zamknięcie drzwi na 2. (15 000) → 8. piętro (33 000, postój 9 s) → z powrotem na 4. (54 000) + otwarcie.
    expect(waiting.eta?.arrivalAt).toBe(56_000);

    // Kabina mija 4. piętro bez zatrzymania (grupa się nie mieści, nikt inny tam nie czeka).
    b.run(21_500);
    expect(b.state.core.car).toMatchObject({ phase: 'moving', floor: 4, targetFloor: 5 });
    expect(get(b, g.callId)).toMatchObject({ status: 'waiting_for_space', eta: { arrivalAt: 56_000 } });

    // Po wysadzeniu pasażerów na 8. kabina zawraca: teraz „Winda jedzie do Ciebie”.
    b.run(45_000);
    expect(b.state.core.car).toMatchObject({ phase: 'moving', direction: 'down' });
    expect(get(b, g.callId)).toMatchObject({ status: 'assigned', assignment: { tripIndex: 0 } });

    // Zgłoszenie nie przepada: kabina wraca i otwiera drzwi o przewidzianym czasie.
    b.run(55_999);
    expect(get(b, g.callId).status).toBe('assigned');
    b.run(56_000);
    expect(get(b, g.callId)).toMatchObject({ status: 'arrived', assignment: { availability: 'confirmed' } });

    // Symulator potwierdza wejście grupy.
    b.run(58_500);
    expect(get(b, g.callId).status).toBe('completed');
    expect(b.state.core.car.occupancy).toBe(2);
  });
});

describe('przydział grup', () => {
  it('grupa większa niż pojemność kabiny dostaje komunikat o podziale', () => {
    const b = demo();
    const r = b.appCall({ requestId: 'r', installationId: 'A', floor: 3, passengerCount: 7 }, 0);
    expect(r).toMatchObject({ ok: false, error: 'group_too_large' });
  });

  it('kilka grup jedzie razem, jeśli suma mieści się w pojemności', () => {
    const b = demo();
    const a = call(b, 'A', 5, 3, 0);
    const c = call(b, 'B', 5, 3, 0);
    expect(get(b, a.callId).assignment?.tripIndex).toBe(0);
    expect(get(b, c.callId).assignment?.tripIndex).toBe(0);
    expect(get(b, a.callId).eta?.arrivalAt).toBe(get(b, c.callId).eta?.arrivalAt);
  });

  it('całość albo nic: starsza grupa jedzie, młodsza czeka w całości i zachowuje czas przyjęcia', () => {
    const b = demo();
    const a = call(b, 'A', 5, 4, 0);
    const c = call(b, 'B', 5, 3, 100);
    expect(get(b, a.callId)).toMatchObject({ status: 'assigned', assignment: { tripIndex: 0 } });
    expect(get(b, c.callId)).toMatchObject({ status: 'waiting_for_space', createdAt: 100, assignment: { tripIndex: 1 } });
    // Nie ma częściowego przydziału: 2 wolne miejsca nie są obiecywane 3-osobowej grupie.
    expect(get(b, c.callId).eta!.arrivalAt).toBeGreaterThan(get(b, a.callId).eta!.arrivalAt);
  });

  it('zmiana liczby osób ponownie sprawdza miejsce i aktualizuje prognozę', () => {
    const b = demo();
    const a = call(b, 'A', 5, 4, 0);
    const c = call(b, 'B', 5, 3, 100);
    expect(get(b, c.callId).status).toBe('waiting_for_space');
    const r = b.updatePassengerCount('B', c.callId, 2, 200);
    expect(r.ok).toBe(true);
    expect(get(b, c.callId)).toMatchObject({ status: 'assigned', assignment: { tripIndex: 0, seats: 2 } });
    expect(get(b, c.callId).eta?.arrivalAt).toBe(get(b, a.callId).eta?.arrivalAt);
    // Zmiana ponad pojemność jest odrzucana.
    expect(b.updatePassengerCount('B', c.callId, 9, 300)).toMatchObject({ ok: false, error: 'group_too_large' });
  });

  it('bez danych o zajętości: „dostępność niepotwierdzona”, bez obietnicy miejsca', () => {
    const b = demo({ occupancyTelemetry: false });
    const c = call(b, 'A', 3, 2, 0);
    expect(b.state.core.car.occupancy).toBeNull();
    expect(get(b, c.callId).assignment?.availability).toBe('unconfirmed');
    expect(get(b, c.callId).eta?.seconds).toBe(11);
  });
});

describe('zgłoszenia i kolejka', () => {
  it('ponowienie z tym samym requestId zwraca istniejące zgłoszenie i nie tworzy postoju', () => {
    const b = demo();
    const input = { requestId: 'r-1', installationId: 'A', floor: 6, passengerCount: 2 };
    const first = b.appCall(input, 0);
    const again = b.appCall(input, 500);
    expect(first).toMatchObject({ ok: true, created: true });
    expect(again).toMatchObject({ ok: true, created: false });
    if (!first.ok || !again.ok) throw new Error();
    expect(again.call.callId).toBe(first.call.callId);
    expect(b.state.core.calls).toHaveLength(1);
  });

  it('jedna instalacja ma najwyżej jedno aktywne wezwanie', () => {
    const b = demo();
    call(b, 'A', 6, 1, 0);
    const r = b.appCall({ requestId: 'inne', installationId: 'A', floor: 3, passengerCount: 1 }, 10);
    expect(r).toMatchObject({ ok: false, error: 'active_call_exists' });
  });

  it('anulowanie usuwa tylko własne zgłoszenie; postój z przycisku zostaje w trasie', () => {
    const b = demo();
    const c = call(b, 'A', 4, 1, 0);
    b.simInput({ type: 'hall_press', floor: 4 }, 0);
    expect(b.cancel('B', c.callId, 100)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(b.cancel('A', c.callId, 100)).toMatchObject({ ok: true });
    expect(get(b, c.callId).status).toBe('cancelled');
    b.run(14_000);
    expect(b.state.core.car).toMatchObject({ phase: 'doors_open', floor: 4 });
  });

  it('anulowanie jedynego wezwania: kabina kończy bieżący odcinek i staje', () => {
    const b = demo();
    const c = call(b, 'A', 8, 1, 0);
    b.run(1_000);
    b.cancel('A', c.callId, 1_000);
    b.run(10_000);
    expect(b.state.core.car).toMatchObject({ phase: 'idle', floor: 1 });
  });

  it('cele kabinowe zostają w trasie', () => {
    const b = demo();
    b.simInput({ type: 'car_press', floor: 7 }, 0);
    const c = call(b, 'A', 3, 1, 0);
    b.cancel('A', c.callId, 100);
    b.run(30_000);
    expect(b.state.core.calls.find((x) => x.source === 'car_button')?.status).toBe('completed');
    expect(b.state.core.car.floor).toBe(7);
  });

  it('grupa, która nie wsiądzie przed zamknięciem drzwi, traci przydział i może wezwać ponownie', () => {
    const b = demo({ autoBoard: false });
    const c = call(b, 'A', 2, 2, 0);
    b.run(8_000);
    expect(get(b, c.callId).status).toBe('arrived');
    b.run(13_000); // drzwi zaczynają się zamykać
    expect(get(b, c.callId)).toMatchObject({ status: 'expired', assignment: null, eta: null });
    const again = b.appCall({ requestId: 'ponownie', installationId: 'A', floor: 2, passengerCount: 2 }, 14_000);
    expect(again).toMatchObject({ ok: true, created: true });
  });

  it('powtórzone zdarzenie sprzętowe (ten sam eventId) jest ignorowane', () => {
    const b = demo();
    const e = { eventId: 'hw-1', at: 0, sourceId: 'btn-3', type: 'hall_call' as const, floor: 3, direction: null };
    b.controllerEvent(e, 0);
    b.controllerEvent(e, 10);
    expect(b.state.core.calls.filter((c) => c.source === 'hall_button')).toHaveLength(1);
  });

  it('restart backendu: stan z zapisu odtwarza tę samą windę i kolejkę', () => {
    const live = demo();
    const g = call(live, 'A', 4, 2, 0);
    live.simInput({ type: 'hall_press', floor: 2, dests: [8, 8, 8, 8, 8] }, 0);
    live.run(7_000);

    // „Restart”: zapis JSON i odtworzenie w nowym obiekcie, potem przerwa w działaniu.
    const saved = JSON.parse(JSON.stringify(live.state));
    const restored = new Building(saved);
    live.run(40_000);
    restored.run(40_000);

    expect(restored.state.core.car).toEqual(live.state.core.car);
    expect(get(restored, g.callId)).toEqual(get(live, g.callId));
    expect(get(restored, g.callId).createdAt).toBe(0);
  });
});

describe('kolejność jazdy (zbiorczo w dół)', () => {
  /** Piętra, na których kolejno otwierały się drzwi. */
  function doorStops(b: Building, until: number): number[] {
    const out: number[] = [];
    for (let t = 0; t <= until; t += 250) {
      b.run(t);
      const car = b.state.core.car;
      if (car.phase === 'doors_open' && out[out.length - 1] !== car.floor) out.push(car.floor);
    }
    return out;
  }

  it('wezwania z 6. i 3. (kabina na parterze): najpierw 6., 3. po drodze w dół', () => {
    const b = demo();
    b.simInput({ type: 'hall_press', floor: 3, dests: [0] }, 0);
    b.simInput({ type: 'hall_press', floor: 6, dests: [0] }, 0);
    expect(doorStops(b, 80_000)).toEqual([6, 3, 0]);
  });

  it('kolejność naciśnięć nie ma znaczenia: 6. potem 3. daje ten sam przejazd', () => {
    const b = demo();
    b.simInput({ type: 'hall_press', floor: 6, dests: [0] }, 0);
    b.simInput({ type: 'hall_press', floor: 3, dests: [0] }, 1_000);
    expect(doorStops(b, 80_000)).toEqual([6, 3, 0]);
  });

  it('kabina nie jedzie po grupę, która się nie zmieści, i nie zabiera jej części', () => {
    const b = demo();
    b.simInput({ type: 'hall_press', floor: 8, dests: [0, 0, 0, 0, 0] }, 0);
    const g = call(b, 'A', 5, 3, 1_000);
    const stops = doorStops(b, 120_000);
    // 8. (5 osób wsiada) → mija 5. → parter (wysiadają) → wraca po całą grupę na 5.
    expect(stops.slice(0, 3)).toEqual([8, 0, 5]);
    expect(get(b, g.callId).status).toBe('completed');
  });

  it('osoby spod jednego przycisku wsiadają razem albo czekają (bez częściowego zabierania)', () => {
    const b = demo();
    b.simInput({ type: 'hall_press', floor: 9, dests: [0, 0, 0, 0, 0] }, 0);
    b.simInput({ type: 'hall_press', floor: 7, dests: [0, 0, 0] }, 0);
    doorStops(b, 60_000);
    // Na 7. jest 1 wolne miejsce, a czekają 3 osoby: nikt nie wsiada częściowo.
    expect(b.state.core.car.occupancy === 5 || b.state.core.car.occupancy === 0 || b.state.core.car.occupancy === 3).toBe(true);
    b.run(400_000);
    expect(b.sim.s.hallWaiting).toHaveLength(0);
  });
});
