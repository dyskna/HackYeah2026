/**
 * Ekran mieszkańca podpięty pod żywy stan serwera.
 *
 * - „Wezwij windę”: ekran oczekiwania pojawia się dopiero po akceptacji serwera.
 * - Zmiana liczby osób po wezwaniu: serwer ponownie sprawdza miejsce (PATCH).
 * - Komunikaty dla czytnika ekranu: przyjęcie, zmiana dostępności, przyjazd,
 *   awaria, utrata połączenia. Ruch kabiny nie jest odczytywany.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstallationView, MyCallView, Notice } from '../../shared/protocol';
import { Api, ApiFailure } from '../lib/api';
import { etaDisplay, floorName, people } from '../lib/format';
import { residentLive, useLive, useNotices, useReducedMotion, useTicker } from '../state/hooks';
import { ResidentLayout } from './ResidentLayout';

const api = new Api();

export function ResidentScreen({
  installation,
  onSettings,
  onUnauthorized,
}: {
  installation: InstallationView;
  onSettings: () => void;
  onUnauthorized: () => void;
}) {
  const live = residentLive();
  const state = useLive(live);
  const smooth = !useReducedMotion();
  const view = state.view;
  const online = state.status === 'online' && !state.stale;

  const [floor, setFloor] = useState(installation.defaultFloor);
  const [count, setCount] = useState(1);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [countPending, setCountPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  /** Zgłoszenie z odpowiedzi POST, zanim dotrze aktualizacja przez WebSocket. */
  const [accepted, setAccepted] = useState<{ call: MyCallView; at: number } | null>(null);
  const [announce, setAnnounce] = useState<{ polite: string; assertive: string }>({ polite: '', assertive: '' });

  useEffect(() => {
    if (state.status === 'unauthorized') onUnauthorized();
  }, [state.status, onUnauthorized]);

  const call: MyCallView | null =
    view?.myCall ?? (accepted && Date.now() - accepted.at < 5000 ? accepted.call : null);

  // Odliczanie co sekundę tylko przy aktywnym wezwaniu i połączeniu.
  useTicker(1000, !!call && online);
  const serverNow = live.serverNow();

  // Suwak w trakcie wezwania pokazuje wartość z serwera, chyba że trwa zmiana.
  const serverCount = call?.passengerCount ?? null;
  useEffect(() => {
    if (serverCount !== null && !countPending) setCount(serverCount);
  }, [serverCount, countPending]);

  useEffect(() => {
    if (view?.myCall) setAccepted(null);
  }, [view?.myCall]);

  // ── komunikaty dla czytnika ekranu ──
  const say = useCallback((text: string, urgent = false) => {
    setAnnounce((a) => (urgent ? { ...a, assertive: text } : { ...a, polite: text }));
  }, []);

  const prev = useRef<{ status: string | null; avail: string | null; online: boolean; fault: boolean }>({
    status: null,
    avail: null,
    online: true,
    fault: false,
  });
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    const status = call?.status ?? null;
    const avail = call?.assignment?.availability ?? null;
    const fault = view.car.phase === 'fault';
    if (online !== p.online) say(online ? 'Połączenie przywrócone. Pobrano aktualny stan windy.' : 'Brak połączenia. Pozycja windy może być nieaktualna.', !online);
    if (fault !== p.fault) say(fault ? 'Winda niedostępna. Nowe wezwania są zablokowane.' : 'Awaria usunięta. Winda znów jest dostępna.', true);
    if (call && status !== p.status) {
      if (status === 'arrived') say(`Winda przyjechała ${call.floor === 0 ? 'na parter' : `na ${call.floor}. piętro`}.`, true);
      else if (status === 'waiting_for_space') say('Najbliższy przejazd nie pomieści Twojej grupy. Zgłoszenie pozostaje aktywne.');
      else if (p.status === 'waiting_for_space') say('Jest miejsce dla Twojej grupy. Winda jedzie do Ciebie.');
    } else if (call && avail !== p.avail && p.avail !== null) {
      say(avail === 'unconfirmed' ? 'Dostępność miejsc niepotwierdzona.' : 'Przewidywane miejsce dla Twojej grupy.');
    }
    prev.current = { status, avail, online, fault };
  }, [view, call, online, say]);

  const onNotice = useCallback(
    (n: Notice) => {
      if (n.kind === 'expired') {
        setBanner('Przydział miejsc wygasł, bo drzwi się zamknęły. Możesz wezwać windę ponownie.');
        say('Przydział miejsc wygasł. Możesz wezwać windę ponownie.');
      } else if (n.kind === 'completed') {
        setBanner(null);
      } else if (n.kind === 'cancelled') {
        say('Wezwanie anulowane.');
      }
    },
    [say],
  );
  useNotices(live, onNotice);

  // ── działania ──
  const onCall = async () => {
    if (!view || sending) return;
    setSending(true);
    setError(null);
    setBanner(null);
    try {
      const r = await api.callElevator({ floor, passengerCount: count, direction: view.building.directionalCalls ? direction : null });
      setAccepted({ call: r.call, at: Date.now() });
      const eta = r.call.eta ? etaDisplay(r.call.eta.seconds).spoken : null;
      say(`Wezwanie przyjęte. ${floorName(floor)}, ${people(count)}.${eta ? ` Przyjazd za około ${eta}.` : ''}`);
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.network ? 'Brak odpowiedzi serwera. Wezwanie nie zostało potwierdzone, spróbuj ponownie.' : e.message) : 'Nie udało się wezwać windy.');
      if (e instanceof ApiFailure && e.status === 401) onUnauthorized();
    } finally {
      setSending(false);
    }
  };

  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCount = (n: number) => {
    setCount(n);
    if (!call) return;
    // Zmiana po wezwaniu: krótka zwłoka, żeby przesunięcie suwaka dało jedno żądanie.
    setCountPending(true);
    setError(null);
    if (countTimer.current) clearTimeout(countTimer.current);
    countTimer.current = setTimeout(async () => {
      try {
        await api.setPassengerCount(call.callId, n);
      } catch (e) {
        setError(e instanceof ApiFailure ? e.message : 'Nie udało się zmienić liczby osób.');
        if (call.passengerCount) setCount(call.passengerCount);
      } finally {
        setCountPending(false);
      }
    }, 400);
  };

  const onCancel = async () => {
    if (!call || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await api.cancelCall(call.callId);
      setAccepted(null);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Nie udało się anulować wezwania.');
    } finally {
      setCancelling(false);
    }
  };

  if (!view) {
    return (
      <div className="loading" role="status">
        {state.status === 'offline' ? 'Brak połączenia. Ponawiamy…' : 'Łączenie z windą…'}
      </div>
    );
  }

  return (
    <>
      <ResidentLayout
        view={view}
        online={online}
        serverNow={serverNow}
        clockOffsetMs={state.clockOffsetMs}
        smooth={smooth}
        call={call}
        floor={floor}
        onFloor={(f) => {
          setFloor(f);
          setError(null);
        }}
        count={count}
        onCount={onCount}
        direction={direction}
        onDirection={setDirection}
        sending={sending}
        onCall={onCall}
        cancelling={cancelling}
        onCancel={onCancel}
        countPending={countPending}
        error={error}
        banner={banner}
        onSettings={onSettings}
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce.polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {announce.assertive}
      </div>
    </>
  );
}
