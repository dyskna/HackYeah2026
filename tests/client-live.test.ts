import { describe, expect, it } from 'vitest';
import { Api, ApiFailure } from '../src/client/lib/api';
import type { SocketLike } from '../src/client/lib/live';
import { LiveConnection } from '../src/client/lib/live';

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: string[] = [];
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  msg(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function view(version: number, floor = 0) {
  return { version, serverNow: 1_000_000, car: { floor }, building: {}, lamps: null, stops: [], myCall: null };
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; at: number }[] = [];
  let now = 0;
  const live = new LiveConnection({
    url: '/ws',
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as never);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= now && timers.includes(t)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    }
  };
  return { live, sockets, advance };
}

describe('połączenie na żywo', () => {
  it('przyjmuje snapshot i odrzuca starsze aktualizacje', () => {
    const { live, sockets } = setup();
    live.start();
    sockets[0].open();
    sockets[0].msg({ type: 'snapshot', view: view(5, 3) });
    expect(live.state).toMatchObject({ status: 'online', stale: false, view: { version: 5 } });
    sockets[0].msg({ type: 'update', view: view(4, 9) });
    expect(live.state.view?.version).toBe(5);
    sockets[0].msg({ type: 'update', view: view(6, 4) });
    expect(live.state.view?.car.floor).toBe(4);
  });

  it('po utracie połączenia: widok „ostatnio znany”, ponowne łączenie i pełny stan', () => {
    const { live, sockets, advance } = setup();
    live.start();
    sockets[0].open();
    sockets[0].msg({ type: 'snapshot', view: view(5, 3) });
    sockets[0].drop();
    expect(live.state).toMatchObject({ status: 'offline', stale: true, view: { version: 5 } });

    advance(1_000); // backoff 250–500 ms
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    // Zaległa (starsza) wiadomość z poprzedniego gniazda jest ignorowana.
    sockets[0].msg({ type: 'update', view: view(9) });
    expect(live.state.view?.version).toBe(5);
    sockets[1].msg({ type: 'snapshot', view: view(7, 6) });
    expect(live.state).toMatchObject({ status: 'online', stale: false, view: { version: 7 } });
  });

  it('zdarzenie „offline” przeglądarki: od razu widok ostatnio znany, potem ponowne łączenie', () => {
    const { live, sockets, advance } = setup();
    live.start();
    sockets[0].open();
    sockets[0].msg({ type: 'snapshot', view: view(3) });
    live.goOffline();
    expect(live.state).toMatchObject({ status: 'offline', stale: true, view: { version: 3 } });
    sockets[0].msg({ type: 'update', view: view(4) }); // spóźniona wiadomość ze starego gniazda
    expect(live.state.view?.version).toBe(3);
    advance(1_000);
    expect(sockets).toHaveLength(2);
  });

  it('cofnięty dostęp (kod 4001) kończy próby łączenia', () => {
    const { live, sockets, advance } = setup();
    live.start();
    sockets[0].open();
    sockets[0].drop(4001);
    advance(60_000);
    expect(live.state.status).toBe('unauthorized');
    expect(sockets).toHaveLength(1);
  });

  it('wiadomość „revoked” od serwera natychmiast kończy sesję', () => {
    const { live, sockets, advance } = setup();
    live.start();
    sockets[0].open();
    sockets[0].msg({ type: 'snapshot', view: view(2) });
    sockets[0].msg({ type: 'revoked' });
    advance(60_000);
    expect(live.state).toMatchObject({ status: 'unauthorized', stale: true });
    expect(sockets).toHaveLength(1);
  });

  it('martwe połączenie (brak wiadomości) jest zrywane i nawiązywane od nowa', () => {
    const { live, sockets, advance } = setup();
    live.start();
    sockets[0].open();
    sockets[0].msg({ type: 'snapshot', view: view(1) });
    for (let i = 0; i < 4; i++) advance(20_000);
    expect(live.state.status).not.toBe('online');
    advance(1_000);
    expect(sockets.length).toBeGreaterThan(1);
  });
});

describe('API: wezwanie windy', () => {
  it('ponawia po błędzie sieci z tym samym requestId', async () => {
    const bodies: { requestId: string }[] = [];
    let n = 0;
    const api = new Api({
      sleep: async () => {},
      newRequestId: () => 'req-xyz',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        if (++n < 3) throw new TypeError('network down');
        return new Response(JSON.stringify({ call: { callId: 'c1', status: 'assigned' }, created: false }), { status: 200 });
      },
    });
    const r = await api.callElevator({ floor: 4, passengerCount: 2 });
    expect(r).toMatchObject({ requestId: 'req-xyz', call: { callId: 'c1' } });
    expect(bodies.map((b) => b.requestId)).toEqual(['req-xyz', 'req-xyz', 'req-xyz']);
  });

  it('błąd serwera (np. za duża grupa) nie jest ponawiany i niesie komunikat', async () => {
    let n = 0;
    const api = new Api({
      sleep: async () => {},
      fetch: async () => {
        n++;
        return new Response(JSON.stringify({ error: 'group_too_large', message: 'Podzielcie się' }), { status: 422 });
      },
    });
    await expect(api.callElevator({ floor: 4, passengerCount: 7 })).rejects.toMatchObject({ status: 422, code: 'group_too_large' });
    expect(n).toBe(1);
  });

  it('bez odpowiedzi serwera nie ma potwierdzenia', async () => {
    const api = new Api({ sleep: async () => {}, fetch: async () => { throw new TypeError('offline'); } });
    const err = await api.callElevator({ floor: 1, passengerCount: 1 }, 1).catch((e) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).network).toBe(true);
  });
});
