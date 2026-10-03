import { describe, expect, it } from 'vitest';
import { isPending } from '../src/shared/model';
import { call, demo, get } from './helpers';

describe('symulator', () => {
  it('pełna kabina pomija postój tylko dla przycisku piętrowego', () => {
    const b = demo();
    b.simInput({ type: 'hall_press', floor: 1, dests: [9, 9, 9, 9, 9, 9] }, 0);
    b.run(10_000); // 6 osób wsiadło na 1.
    expect(b.state.core.car.occupancy).toBe(6);
    b.simInput({ type: 'hall_press', floor: 4, dests: [0] }, 10_000);
    b.run(25_000); // kabina mija 4. (drzwi na 1. zamknięte o 12 000, 4. o 21 000)
    expect(b.state.core.car.floor).toBeGreaterThan(4);
    expect(b.state.core.calls.find((c) => c.source === 'hall_button' && c.floor === 4)?.status).toBe('accepted');
  });

  it('kto się nie zmieścił, naciska przycisk ponownie i czeka na kolejny przejazd', () => {
    const b = demo();
    b.simInput({ type: 'hall_press', floor: 2, dests: [7, 7, 7, 7, 7, 7, 7, 7] }, 0);
    b.run(20_000);
    const hall2 = b.state.core.calls.filter((c) => c.source === 'hall_button' && c.floor === 2);
    expect(hall2).toHaveLength(2);
    expect(hall2[1].status).toBe('accepted');
    b.run(200_000);
    expect(b.sim.s.hallWaiting).toHaveLength(0);
  });

  it('wejście grupy potwierdza symulator; zajętość rośnie o zadeklarowaną liczbę', () => {
    const b = demo({ autoBoard: false });
    const c = call(b, 'A', 3, 4, 0);
    b.run(11_000);
    expect(get(b, c.callId).status).toBe('arrived');
    expect(b.simInput({ type: 'board_group', callId: c.callId }, 12_000)).toEqual({ ok: true });
    expect(get(b, c.callId).status).toBe('completed');
    expect(b.state.core.car.occupancy).toBe(4);
    expect(b.state.core.calls.some((x) => x.source === 'car_button' && x.floor === 0)).toBe(true);
  });

  it('kierunki: gdy instalacja je rozróżnia, wezwanie wymaga wyboru kierunku', () => {
    const b = demo({ directionalCalls: true });
    expect(b.appCall({ requestId: 'x', installationId: 'A', floor: 3, passengerCount: 1 }, 0)).toMatchObject({
      ok: false,
      error: 'direction_required',
    });
    expect(b.appCall({ requestId: 'y', installationId: 'A', floor: 10, passengerCount: 1, direction: 'up' }, 0)).toMatchObject({
      ok: false,
      error: 'invalid_direction',
    });
    expect(b.appCall({ requestId: 'z', installationId: 'A', floor: 3, passengerCount: 1, direction: 'down' }, 0)).toMatchObject({ ok: true });
  });

  it('żywotność: przy losowym ruchu każde wezwanie z aplikacji zostaje w końcu obsłużone', () => {
    for (let seed = 1; seed <= 60; seed++) {
      let x = seed;
      const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const b = demo({ autoBoard: true });
      let t = 0;
      for (let i = 0; i < 25; i++) {
        t += Math.floor(rnd() * 8000);
        b.run(t);
        const floor = Math.floor(rnd() * 11);
        if (rnd() < 0.5) {
          b.appCall({ requestId: `s${seed}-${i}`, installationId: `inst-${i % 6}`, floor, passengerCount: 1 + Math.floor(rnd() * 6) }, t);
        } else {
          const n = Math.floor(rnd() * 4);
          b.simInput({ type: 'hall_press', floor, dests: Array.from({ length: n }, () => Math.floor(rnd() * 11)).filter((d) => d !== floor) }, t);
        }
        expect(b.state.core.car.occupancy ?? 0).toBeLessThanOrEqual(12);
      }
      b.run(t + 30 * 60_000);
      const stuck = b.state.core.calls.filter((c) => isPending(c) || c.status === 'arrived');
      expect(stuck, `seed ${seed}`).toEqual([]);
      expect(b.nextWakeAt()).toBeNull();
    }
  });
});

describe('ruch tła', () => {
  it('symulowani mieszkańcy naciskają przyciski tylko w oknie podtrzymania, potem winda staje', () => {
    const b = demo({ ambientTraffic: true, ambientMinMs: 10_000, ambientMaxMs: 20_000 });
    expect(b.nextWakeAt()).toBeNull(); // nikt nie ogląda: brak ruchu
    b.keepAlive(0, 120_000);
    b.run(120_000);
    const presses = b.state.core.calls.filter((c) => c.source === 'hall_button').length;
    expect(presses).toBeGreaterThanOrEqual(3);
    b.run(30 * 60_000);
    expect(b.state.core.calls.filter((c) => c.source === 'hall_button').length).toBeLessThanOrEqual(presses + 1);
    expect(b.nextWakeAt()).toBeNull();
  });
});
