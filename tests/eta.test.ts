import { describe, expect, it } from 'vitest';
import { call, demo, get } from './helpers';

describe('ETA', () => {
  it('test kontrolny: parter → 5. piętro bez postojów, drzwi zamknięte, do otwarcia 17 s', () => {
    const b = demo();
    const c = call(b, 'A', 5, 1, 0);
    expect(get(b, c.callId).eta).toMatchObject({ seconds: 17, arrivalAt: 17_000 });

    // Symulator faktycznie otwiera drzwi po 17 s, nie wcześniej.
    b.run(16_999);
    expect(b.state.core.car).toMatchObject({ phase: 'doors_opening', floor: 5 });
    b.run(17_000);
    expect(b.state.core.car).toMatchObject({ phase: 'doors_open', floor: 5, phaseStartedAt: 17_000 });
    expect(get(b, c.callId).status).toBe('arrived');
  });

  it('czasy pochodzą z konfiguracji, nie ze stałych', () => {
    const b = demo({ travelPerFloorMs: 2000, doorOpenMs: 1000 });
    const c = call(b, 'A', 5, 1, 0);
    expect(get(b, c.callId).eta?.seconds).toBe(5 * 2 + 1);
  });

  it('ETA odlicza się z biegiem czasu (pozostały czas fazy ruchu)', () => {
    const b = demo();
    const c = call(b, 'A', 5, 1, 0);
    b.run(4_500); // kabina w połowie odcinka 1 → 2
    expect(b.state.core.car).toMatchObject({ phase: 'moving', floor: 1, targetFloor: 2 });
    expect(get(b, c.callId).eta).toMatchObject({ arrivalAt: 17_000, seconds: 13 });
  });

  it('postój przed Tobą dodaje cykl drzwi (2 + 5 + 2 s) i opisuje zmianę', () => {
    const b = demo();
    const c = call(b, 'A', 3, 2, 0);
    expect(get(b, c.callId).eta?.seconds).toBe(11);
    // Ktoś wzywa z 6.: kabina jedzie najpierw na 6., a Ciebie zabiera w drodze w dół.
    b.simInput({ type: 'hall_press', floor: 6 }, 0);
    // 6 pięter × 3 s + postój 9 s + 3 piętra × 3 s + otwarcie 2 s
    expect(get(b, c.callId).eta).toMatchObject({ seconds: 38, reason: { kind: 'stop_added', floor: 6 } });
    expect(get(b, c.callId).status).toBe('accepted'); // kabina na razie jedzie od Ciebie
  });

  it('wezwanie na piętrze, na którym stoi kabina: tylko otwarcie drzwi', () => {
    const b = demo();
    const c = call(b, 'A', 0, 1, 0);
    expect(get(b, c.callId).eta?.seconds).toBe(2);
  });

  it('kabina w trakcie postoju: liczy pozostały postój i zamknięcie drzwi', () => {
    const b = demo();
    b.simInput({ type: 'car_press', floor: 1 }, 0); // jazda na 1., drzwi otwarte od 5 s
    b.run(6_000); // drzwi otwarte od 5 000, zamykanie od 10 000, zamknięte 12 000
    expect(b.state.core.car.phase).toBe('doors_open');
    const c = call(b, 'A', 3, 1, 6_000);
    // 12 000 + 2 × 3 000 + 2 000 = 20 000
    expect(get(b, c.callId).eta).toMatchObject({ arrivalAt: 20_000, seconds: 14 });
  });

  it('awaria przerywa prognozę i blokuje nowe wezwania', () => {
    const b = demo();
    const c = call(b, 'A', 5, 1, 0);
    b.run(4_000);
    b.simInput({ type: 'fault', active: true, reason: 'Test' }, 4_000);
    expect(b.state.core.car.phase).toBe('fault');
    expect(get(b, c.callId).eta).toBeNull();
    const r = b.appCall({ requestId: 'nowe', installationId: 'B', floor: 2, passengerCount: 1 }, 4_000);
    expect(r).toMatchObject({ ok: false, error: 'fault' });

    // Kabina stoi między piętrami; po usunięciu awarii kończy odcinek bez skoku.
    b.run(60_000);
    expect(b.state.core.car.phase).toBe('fault');
    b.simInput({ type: 'fault', active: false }, 60_000);
    // Do końca odcinka 1 → 2 zostało 2 s, potem 3 piętra i otwarcie.
    expect(get(b, c.callId).eta).toMatchObject({ arrivalAt: 60_000 + 2_000 + 9_000 + 2_000 });
  });
});
