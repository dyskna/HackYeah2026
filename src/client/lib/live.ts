/**
 * Połączenie na żywo z serwerem (WebSocket) z ponownym łączeniem.
 *
 * - Serwer jest jedynym źródłem prawdy: klient tylko przyjmuje kolejne wersje.
 * - Wiadomości ze starszą wersją niż ostatnio przyjęta są ignorowane.
 * - Po utracie połączenia widok zostaje jako „ostatnio znany” (stale = true),
 *   a po powrocie serwer od razu wysyła pełny stan (snapshot).
 * - Brak wiadomości przez dłuższy czas = połączenie martwe, łączymy od nowa.
 */
import type { Notice, ResidentView, ServerMessage, AdminPayload } from '../../shared/protocol';

export type LinkStatus = 'connecting' | 'online' | 'offline' | 'unauthorized';

/** Minimalny interfejs gniazda (przeglądarkowy WebSocket albo atrapa w testach). */
export interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface LiveOptions {
  url: string;
  createSocket: (url: string) => SocketLike;
  /** Sprawdza, czy sesja jest nadal ważna (np. GET /api/me). false = brak dostępu. */
  checkSession?: () => Promise<boolean>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  heartbeatMs?: number;
  deadAfterMs?: number;
  maxBackoffMs?: number;
}

export interface LiveState<V> {
  status: LinkStatus;
  view: V | null;
  /** Widok pochodzi sprzed utraty połączenia. */
  stale: boolean;
  /** serverNow − czas lokalny; do przeliczania znaczników czasu serwera. */
  clockOffsetMs: number;
  lastMessageAt: number | null;
}

type ViewOf<M> = M extends 'admin' ? AdminPayload & { serverNow: number } : ResidentView;

export class LiveConnection<Mode extends 'resident' | 'admin' = 'resident'> {
  state: LiveState<ViewOf<Mode>> = { status: 'connecting', view: null, stale: false, clockOffsetMs: 0, lastMessageAt: null };
  private socket: SocketLike | null = null;
  private listeners = new Set<(s: LiveState<ViewOf<Mode>>) => void>();
  private noticeListeners = new Set<(n: Notice) => void>();
  private version = -1;
  private offsetSamples: number[] = [];
  private attempts = 0;
  private retryTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private stopped = false;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (id: unknown) => void;

  constructor(private opts: LiveOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  subscribe(fn: (s: LiveState<ViewOf<Mode>>) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  onNotice(fn: (n: Notice) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer(this.retryTimer);
    this.clearTimer(this.heartbeatTimer);
    this.socket?.close(1000, 'stop');
    this.socket = null;
  }

  /** Np. po zdarzeniu „online” przeglądarki: nie czekamy na koniec odliczania. */
  reconnectNow(): void {
    if (this.stopped || this.state.status === 'online') return;
    this.clearTimer(this.retryTimer);
    this.attempts = 0;
    this.open();
  }

  /**
   * Przeglądarka zgłosiła utratę sieci: od razu widok „ostatnio znany”,
   * bez czekania na wykrycie martwego połączenia. Próby łączenia trwają dalej.
   */
  goOffline(): void {
    if (this.stopped || this.state.status === 'unauthorized') return;
    const ws = this.socket;
    this.socket = null;
    this.clearTimer(this.heartbeatTimer);
    ws?.close(4000, 'offline');
    this.set({ status: 'offline', stale: this.state.view !== null });
    this.clearTimer(this.retryTimer);
    this.scheduleRetry();
  }

  /** Prośba o pełny stan bez zrywania połączenia. */
  sync(): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify({ type: 'sync' }));
  }

  /** Czas serwera „teraz” według lokalnego zegara i ostatniej korekty. */
  serverNow(): number {
    return this.now() + this.state.clockOffsetMs;
  }

  private set(patch: Partial<LiveState<ViewOf<Mode>>>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private open() {
    if (this.stopped) return;
    this.socket?.close();
    this.set({ status: this.state.status === 'unauthorized' ? 'unauthorized' : this.state.view ? 'offline' : 'connecting' });
    let ws: SocketLike;
    try {
      ws = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.touch();
    };
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      this.touch();
      if (typeof ev.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = (ev) => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.clearTimer(this.heartbeatTimer);
      if (ev.code === 4001) {
        this.set({ status: 'unauthorized', stale: true });
        return;
      }
      this.set({ status: 'offline', stale: this.state.view !== null });
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose przychodzi zaraz po błędzie */
    };
  }

  private handle(msg: ServerMessage) {
    if (msg.type === 'notice') {
      if (msg.version >= this.version) for (const l of this.noticeListeners) l(msg.notice);
      return;
    }
    if (msg.type === 'pong') return;
    if (msg.type === 'revoked') {
      this.stopped = true;
      this.clearTimer(this.heartbeatTimer);
      this.clearTimer(this.retryTimer);
      const ws = this.socket;
      this.socket = null;
      ws?.close(1000, 'revoked');
      this.set({ status: 'unauthorized', stale: this.state.view !== null });
      return;
    }
    const view = (msg.type === 'admin' ? msg : msg.view) as ViewOf<Mode>;
    const version = (view as { version: number }).version;
    const serverNow = (view as { serverNow: number }).serverNow;
    // Snapshot po ponownym połączeniu może mieć tę samą wersję; starsze aktualizacje odrzucamy.
    const accept = msg.type === 'update' ? version > this.version : version >= this.version;
    if (!accept) return;
    this.version = version;
    // Opóźnienie sieci tylko zaniża różnicę zegarów, więc bierzemy maksimum z ostatnich próbek:
    // kabina nie drga przy każdej wiadomości.
    this.offsetSamples.push(serverNow - this.now());
    if (this.offsetSamples.length > 12) this.offsetSamples.shift();
    this.set({ view, stale: false, status: 'online', clockOffsetMs: Math.max(...this.offsetSamples) });
  }

  /** Ping i wykrywanie martwego połączenia. */
  private touch() {
    this.state.lastMessageAt = this.now();
    this.clearTimer(this.heartbeatTimer);
    const hb = this.opts.heartbeatMs ?? 20_000;
    const dead = this.opts.deadAfterMs ?? 45_000;
    const tick = () => {
      const ws = this.socket;
      if (!ws) return;
      if (this.now() - (this.state.lastMessageAt ?? 0) > dead) {
        ws.close(4000, 'timeout');
        // Część przeglądarek nie wywołuje onclose dla martwego gniazda od razu.
        if (this.socket === ws) ws.onclose?.({ code: 4000 });
        return;
      }
      try {
        ws.send('{"type":"ping"}');
      } catch {
        /* zamknięte */
      }
      this.heartbeatTimer = this.setTimer(tick, hb);
    };
    this.heartbeatTimer = this.setTimer(tick, hb);
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.attempts += 1;
    const max = this.opts.maxBackoffMs ?? 10_000;
    const base = Math.min(max, 500 * 2 ** Math.min(this.attempts - 1, 6));
    const delay = base / 2 + Math.random() * (base / 2);
    // Po kilku nieudanych próbach sprawdzamy, czy dostęp nie został cofnięty.
    if (this.attempts >= 3 && this.opts.checkSession) {
      this.opts.checkSession().then(
        (valid) => {
          if (!valid) {
            this.set({ status: 'unauthorized', stale: this.state.view !== null });
            this.stopped = true;
          }
        },
        () => {},
      );
    }
    this.retryTimer = this.setTimer(() => this.open(), delay);
  }
}
