import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { BuildingInfo, InstallationView } from '../shared/protocol';
import { PUBLIC_DEMO_CODE } from '../shared/config';
import { PrimaryButton } from './components/panel';
import { Api, ApiFailure } from './lib/api';
import { ActivationScreen } from './screens/ActivationScreen';
import { ResidentScreen } from './screens/ResidentScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const Gallery = import.meta.env.DEV ? lazy(() => import('./screens/Gallery')) : null;
const api = new Api();

// ── prosty router na History API ──
const listeners = new Set<() => void>();
export function navigate(path: string) {
  history.pushState(null, '', path);
  listeners.forEach((l) => l());
}
function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener('popstate', cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('popstate', cb);
      };
    },
    () => location.pathname,
  );
}

type Session =
  | { kind: 'loading' }
  | { kind: 'resident'; installation: InstallationView; building: BuildingInfo }
  | { kind: 'none'; revoked: boolean }
  | { kind: 'error' };

export function App() {
  const path = usePath();
  const [session, setSession] = useState<Session>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      setSession({ kind: 'resident', installation: me.installation, building: me.building });
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) setSession({ kind: 'none', revoked: e.code === 'revoked' });
      else setSession({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    if (path !== '/aktywacja' && path !== '/podglad') void load();
  }, [load, path]);

  const onUnauthorized = useCallback(() => setSession({ kind: 'none', revoked: true }), []);

  if (path === '/podglad' && Gallery) {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  if (path === '/aktywacja') {
    return <ActivationScreen onDone={() => { navigate('/'); void load(); }} />;
  }

  switch (session.kind) {
    case 'loading':
      return <div className="loading" role="status">Wczytywanie…</div>;
    case 'error':
      return (
        <main className="page">
          <h1>Brak połączenia</h1>
          <p>Nie udało się połączyć z serwerem. Sprawdź sieć i spróbuj ponownie.</p>
          <button type="button" className="btn-primary" onClick={() => void load()}>Spróbuj ponownie</button>
        </main>
      );
    case 'none':
      return (
        <main className="page">
          <h1>{session.revoked ? 'Dostęp cofnięty' : 'Telefon nie jest aktywowany'}</h1>
          <p>
            {session.revoked
              ? 'Administrator cofnął dostęp dla tego telefonu albo sesja wygasła.'
              : 'Aby wzywać windę, zeskanuj aparatem telefonu kod QR otrzymany od administratora budynku.'}
          </p>
          <p>Poproś administratora budynku o nowy kod QR.</p>
          <div className="push-bottom">
            <div className="hint-text">Wersja demonstracyjna: budynek z symulowaną windą, bez kodu od administratora.</div>
            <PrimaryButton onClick={() => navigate(`/aktywacja#${PUBLIC_DEMO_CODE}`)}>Wejdź do wersji demo</PrimaryButton>
          </div>
        </main>
      );
    case 'resident':
      if (path === '/ustawienia') {
        return (
          <SettingsScreen
            installation={session.installation}
            building={session.building}
            onBack={() => navigate('/')}
            onSaved={(installation) => setSession({ ...session, installation })}
          />
        );
      }
      return <ResidentScreen installation={session.installation} onSettings={() => navigate('/ustawienia')} onUnauthorized={onUnauthorized} />;
  }
}
