import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Notice } from '../../shared/protocol';
import type { LiveState } from '../lib/live';
import { LiveConnection } from '../lib/live';

let resident: LiveConnection<'resident'> | null = null;

/** Jedno połączenie na żywo na kartę przeglądarki. */
export function residentLive(): LiveConnection<'resident'> {
  if (!resident) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    resident = new LiveConnection<'resident'>({
      url: `${proto}//${location.host}/ws`,
      createSocket: (u) => new WebSocket(u) as never,
      checkSession: async () => {
        try {
          const r = await fetch('/api/me');
          return r.status !== 401;
        } catch {
          return true; // brak sieci to nie brak dostępu
        }
      },
    });
    window.addEventListener('online', () => resident?.reconnectNow());
    window.addEventListener('offline', () => resident?.goOffline());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resident?.reconnectNow();
    });
    resident.start();
  }
  return resident;
}

export function useLive<M extends 'resident' | 'admin'>(live: LiveConnection<M>): LiveState<LiveConnection<M>['state']['view'] extends infer V ? V : never> {
  const subscribe = useMemo(() => (cb: () => void) => live.subscribe(cb), [live]);
  return useSyncExternalStore(subscribe, () => live.state) as never;
}

export function useNotices(live: LiveConnection<'resident' | 'admin'>, fn: (n: Notice) => void): void {
  useEffect(() => live.onNotice(fn), [live, fn]);
}

/** Zegar odświeżający komponent co `ms` (np. odliczanie ETA co sekundę). */
export function useTicker(ms: number, active = true): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return t;
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const subscribe = useMemo(
    () => (cb: () => void) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    [],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
