/**
 * Panel administratora (/admin): kody QR, lista instalacji z cofaniem dostępu
 * oraz panel symulatora (przyciski na piętrach i w kabinie, pasażerowie, awaria,
 * ustawienia instalacji). Szyb po prawej pokazuje ten sam stan co telefony.
 * Ładowany osobno, więc nie powiększa aplikacji mieszkańca.
 */
import QRCode from 'qrcode';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { BuildingConfig } from '../../shared/config';
import { PUBLIC_DEMO_CODE } from '../../shared/config';
import type { Call } from '../../shared/model';
import { isActive, isPending } from '../../shared/model';
import type { ActivationCodeView, AdminInstallationView } from '../../shared/protocol';
import { residentView } from '../../engine/view';
import { FloorPicker, PeopleSlider } from '../components/controls';
import { Alert, Display, FieldLabel, PrimaryButton, SecondaryButton } from '../components/panel';
import { Shaft } from '../components/Shaft';
import { Api, ApiFailure } from '../lib/api';
import { carSentence, floorName, floorShort, occupancySentence, people } from '../lib/format';
import { LiveConnection } from '../lib/live';
import { displayFloor } from '../lib/position';
import { useLive, useReducedMotion, useTicker } from '../state/hooks';

const api = new Api();
const message = (e: unknown, fallback: string) => (e instanceof ApiFailure ? e.message : fallback);
const date = (ts: number | null) => (ts ? new Date(ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function AdminScreen() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    api.adminSession().then(
      (r) => setAdmin(r.admin),
      () => setAdmin(false),
    );
  }, []);
  if (admin === null) return <div className="loading" role="status">Wczytywanie…</div>;
  return admin ? <Panel onLogout={() => setAdmin(false)} /> : <Login onDone={() => setAdmin(true)} />;
}

// ───────────────────────── logowanie ─────────────────────────

function Login({ onDone }: { onDone: () => void }) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.adminLogin(password);
      onDone();
    } catch (err) {
      setError(message(err, 'Nie udało się zalogować.'));
      setBusy(false);
    }
  };
  return (
    <main className="page">
      <Display label="Panel administratora" value="ADMIN" valueLabel="Administrator" size="activation" desc="Kody QR, telefony mieszkańców i symulator windy" />
      <form className="page__section field" onSubmit={submit}>
        <FieldLabel htmlFor={id}>Hasło administratora</FieldLabel>
        <input id={id} className="text-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="page__section">
          {error && <Alert>{error}</Alert>}
          <PrimaryButton type="submit" disabled={busy || !password}>
            Zaloguj
          </PrimaryButton>
        </div>
      </form>
    </main>
  );
}

// ───────────────────────── panel ─────────────────────────

type Tab = 'symulator' | 'kody' | 'instalacje';

function Panel({ onLogout }: { onLogout: () => void }) {
  const live = useMemo(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new LiveConnection<'admin'>({ url: `${proto}//${location.host}/ws?role=admin`, createSocket: (u) => new WebSocket(u) as never });
  }, []);
  useEffect(() => {
    live.start();
    const online = () => live.reconnectNow();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      live.stop();
    };
  }, [live]);
  const state = useLive(live);
  const smooth = !useReducedMotion();
  const [tab, setTab] = useState<Tab>('symulator');
  const [installations, setInstallations] = useState<AdminInstallationView[]>([]);
  const loadInstallations = useCallback(() => {
    api.adminInstallations().then(setInstallations, () => {});
  }, []);
  useEffect(loadInstallations, [loadInstallations]);

  useEffect(() => {
    if (state.status === 'unauthorized') onLogout();
  }, [state.status, onLogout]);

  const payload = state.view;
  if (!payload) return <div className="loading" role="status">Łączenie z budynkiem…</div>;
  const now = live.serverNow();
  const view = residentView(payload.core, null, now);
  const b = view.building;
  const online = state.status === 'online' && !state.stale;

  const logout = async () => {
    await api.adminLogout().catch(() => {});
    onLogout();
  };

  return (
    <div className="phone admin">
      <main className="controls">
        <header className="header">
          <div className="header__text">
            <div className="header__title">Panel administratora · {b.name}</div>
            <div className="conn" role="status">
              <span className="conn__dot" data-tone={online ? 'green' : 'amber'} aria-hidden />
              <span>{online ? 'Połączono' : 'Brak sieci'}</span>
            </div>
          </div>
          <button type="button" className="link-btn" onClick={logout}>
            Wyloguj
          </button>
        </header>
        <div className="tabs" role="tablist" aria-label="Sekcje panelu">
          {(
            [
              ['symulator', 'Symulator'],
              ['kody', 'Kody QR'],
              ['instalacje', 'Telefony'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'symulator' && <SimulatorTab core={payload.core} installations={installations} />}
        {tab === 'kody' && <CodesTab config={payload.core.config} />}
        {tab === 'instalacje' && <InstallationsTab installations={installations} reload={loadInstallations} />}
      </main>
      <Shaft
        minFloor={b.minFloor}
        maxFloor={b.maxFloor}
        capacity={b.capacity}
        car={view.car}
        lamps={view.lamps}
        stops={view.stops}
        userFloor={null}
        mode={!online ? 'offline' : view.car.phase === 'fault' ? 'fault' : 'live'}
        clockOffsetMs={state.clockOffsetMs}
        smooth={smooth}
        doorOpenMs={b.doorOpenMs}
        doorCloseMs={b.doorCloseMs}
      />
    </div>
  );
}

// ───────────────────────── symulator ─────────────────────────

function SimulatorTab({ core, installations }: { core: import('../../shared/model').CoreState; installations: AdminInstallationView[] }) {
  useTicker(1000);
  const cfg = core.config;
  const car = core.car;
  const [hallFloor, setHallFloor] = useState(cfg.maxFloor > 5 ? 6 : cfg.maxFloor);
  const [waiting, setWaiting] = useState(2);
  const [carFloor, setCarFloor] = useState(cfg.minFloor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fault = car.phase === 'fault';

  const send = async (input: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api.adminSim(input);
    } catch (e) {
      setError(message(e, 'Polecenie nie zostało wykonane.'));
    } finally {
      setBusy(false);
    }
  };

  const names = new Map(installations.map((i) => [i.installationId, i.name ?? 'Bez nazwy']));
  const queue = core.calls.filter(isActive).sort((a, b) => a.createdAt - b.createdAt);
  const arrived = core.calls.filter((c) => c.status === 'arrived');
  const exitDest = car.floor === cfg.minFloor ? cfg.maxFloor : cfg.minFloor;

  return (
    <div className="admin-sections">
      <Display
        label="Kabina"
        value={floorShort(displayFloor(car))}
        valueLabel={floorName(displayFloor(car))}
        arrow={car.phase === 'moving' ? car.direction : null}
        tone={fault ? 'red' : 'white'}
        desc={`${carSentence(car)} ${occupancySentence(car, cfg.capacity)}`}
      />
      {error && <Alert>{error}</Alert>}

      <section className="panel-section" aria-labelledby="sym-hall">
        <h2 id="sym-hall">Przycisk na piętrze</h2>
        <FloorPicker min={cfg.minFloor} max={cfg.maxFloor} value={hallFloor} onChange={setHallFloor} label="Piętro" />
        <PeopleSlider value={waiting} max={cfg.capacity} onChange={setWaiting} label="Ile osób czeka?" />
        <div className="hint-text hint-text--small">Serwer nie zna tej liczby: zwykły przycisk nie mówi, ilu osób dotyczy.</div>
        <PrimaryButton disabled={busy || fault} onClick={() => send({ type: 'hall_press', floor: hallFloor, waiting })}>
          Naciśnij przycisk na {floorShort(hallFloor) === 'P' ? 'parterze' : `${hallFloor}. piętrze`}
        </PrimaryButton>
      </section>

      <section className="panel-section" aria-labelledby="sym-car">
        <h2 id="sym-car">Kabina</h2>
        <FloorPicker min={cfg.minFloor} max={cfg.maxFloor} value={carFloor} onChange={setCarFloor} label="Przycisk w kabinie" />
        <SecondaryButton disabled={busy || fault} onClick={() => send({ type: 'car_press', floor: carFloor })}>
          Naciśnij {floorShort(carFloor)} w kabinie
        </SecondaryButton>
        <div className="button-row">
          <SecondaryButton disabled={busy} onClick={() => send({ type: 'enter', count: 1, dest: exitDest })}>
            +1 wsiada
          </SecondaryButton>
          <SecondaryButton disabled={busy || !car.occupancy} onClick={() => send({ type: 'exit', count: 1 })}>
            −1 wysiada
          </SecondaryButton>
        </div>
        {arrived.length > 0 && (
          <div className="field">
            <FieldLabel>Grupy z aplikacji przy otwartych drzwiach</FieldLabel>
            {arrived.map((c) => (
              <SecondaryButton key={c.callId} disabled={busy} onClick={() => send({ type: 'board_group', callId: c.callId })}>
                Grupa wsiadła ({people(c.passengerCount ?? 0)})
              </SecondaryButton>
            ))}
          </div>
        )}
      </section>

      <section className="panel-section" aria-labelledby="sym-fault">
        <h2 id="sym-fault">Awaria</h2>
        {fault ? (
          <PrimaryButton disabled={busy} onClick={() => send({ type: 'fault', active: false })}>
            Usuń awarię
          </PrimaryButton>
        ) : (
          <SecondaryButton disabled={busy} onClick={() => send({ type: 'fault', active: true, reason: 'Awaria zgłoszona z panelu' })}>
            Zgłoś awarię windy
          </SecondaryButton>
        )}
      </section>

      <section className="panel-section" aria-labelledby="sym-cfg">
        <h2 id="sym-cfg">Ustawienia instalacji</h2>
        <Switch label="Dane o zajętości kabiny (telemetria)" checked={cfg.occupancyTelemetry} disabled={busy} onChange={(v) => send({ type: 'config', patch: { occupancyTelemetry: v } })} />
        <Switch label="Grupy wsiadają automatycznie" checked={cfg.autoBoard} disabled={busy} onChange={(v) => send({ type: 'config', patch: { autoBoard: v } })} />
        <Switch label="Ruch tła (symulowani mieszkańcy)" checked={cfg.ambientTraffic} disabled={busy} onChange={(v) => send({ type: 'config', patch: { ambientTraffic: v } })} />
        <Switch label="Przyciski z kierunkiem (W górę / W dół)" checked={cfg.directionalCalls} disabled={busy} onChange={(v) => send({ type: 'config', patch: { directionalCalls: v } })} />
      </section>

      <section className="panel-section" aria-labelledby="sym-queue">
        <h2 id="sym-queue">Kolejka ({queue.length})</h2>
        {queue.length === 0 ? (
          <div className="hint-text">Brak aktywnych zgłoszeń.</div>
        ) : (
          <table className="queue-table">
            <thead>
              <tr>
                <th scope="col">Piętro</th>
                <th scope="col">Źródło</th>
                <th scope="col">Osoby</th>
                <th scope="col">Stan</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((c) => (
                <tr key={c.callId}>
                  <td>{floorShort(c.floor)}</td>
                  <td>{sourceLabel(c, names)}</td>
                  <td>{c.passengerCount ?? 'nieznana'}</td>
                  <td>{statusLabel(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <SecondaryButton
        disabled={busy}
        onClick={async () => {
          if (!confirm('Zacząć symulację od nowa? Kabina wróci na parter, kolejka zostanie wyczyszczona. Telefony zostają aktywne.')) return;
          setBusy(true);
          await api.adminReset().catch((e) => setError(message(e, 'Nie udało się zresetować.')));
          setBusy(false);
        }}
      >
        Nowa symulacja (reset)
      </SecondaryButton>
    </div>
  );
}

function sourceLabel(c: Call, names: Map<string, string>): string {
  if (c.source === 'hall_button') return 'przycisk na piętrze';
  if (c.source === 'car_button') return 'przycisk w kabinie';
  return `aplikacja: ${(c.installationId && names.get(c.installationId)) || 'telefon'}`;
}

function statusLabel(c: Call): string {
  if (c.status === 'arrived') return 'winda na piętrze';
  if (c.source !== 'app') return isPending(c) ? 'czeka' : c.status;
  const eta = c.eta ? `, ok. ${c.eta.seconds} s` : '';
  return c.status === 'waiting_for_space' ? `czeka na miejsce${eta}` : c.status === 'assigned' ? `winda jedzie${eta}` : `przyjęte${eta}`;
}

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="switch-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

// ───────────────────────── kody QR ─────────────────────────

function QrImage({ text, label }: { text: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 2, width: 512, color: { dark: '#15171A', light: '#FFFFFF' } }).then(setSrc, () => setSrc(null));
  }, [text]);
  return src ? <img className="qr-img" src={src} alt={label} /> : null;
}

function CodeCard({ title, url, note }: { title: string; url: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="qr-card">
      <QrImage text={url} label={`Kod QR: ${title}`} />
      <div className="qr-card__text">
        <div className="field-label">{title}</div>
        <div className="hint-text">{note}</div>
        <code className="qr-card__url">{url}</code>
        <div className="button-row">
          <SecondaryButton
            onClick={async () => {
              await navigator.clipboard.writeText(url).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Skopiowano' : 'Kopiuj link'}
          </SecondaryButton>
          <SecondaryButton onClick={() => window.print()}>Drukuj</SecondaryButton>
        </div>
      </div>
    </div>
  );
}

function CodesTab({ config }: { config: BuildingConfig }) {
  const [ttl, setTtl] = useState(24 * 7);
  const [code, setCode] = useState<ActivationCodeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await api.adminCreateCode(ttl));
    } catch (e) {
      setError(message(e, 'Nie udało się utworzyć kodu.'));
    } finally {
      setBusy(false);
    }
  };
  const ttls: [number, string][] = [
    [1, '1 godzina'],
    [24, '1 dzień'],
    [24 * 7, '7 dni'],
  ];
  return (
    <div className="admin-sections">
      <section className="panel-section" aria-labelledby="codes-new">
        <h2 id="codes-new">Nowy kod dla mieszkańca</h2>
        <div className="hint-text">Kod jest jednorazowy: aktywuje jeden telefon i wygasa po wybranym czasie. Serwer przechowuje tylko jego skrót.</div>
        <div className="dir-toggle dir-toggle--3" role="group" aria-label="Ważność kodu">
          {ttls.map(([h, label]) => (
            <button key={h} type="button" aria-pressed={ttl === h} onClick={() => setTtl(h)}>
              {label}
            </button>
          ))}
        </div>
        {error && <Alert>{error}</Alert>}
        <PrimaryButton disabled={busy} onClick={create}>
          Utwórz kod QR
        </PrimaryButton>
        {code && <CodeCard title="Kod jednorazowy" url={code.url} note={`Ważny do ${date(code.expiresAt)}. Pokaż albo wydrukuj mieszkańcowi.`} />}
      </section>
      {config.publicDemo && (
        <section className="panel-section" aria-labelledby="codes-demo">
          <h2 id="codes-demo">Kod demonstracyjny</h2>
          <CodeCard
            title="Wersja demo (wielokrotnego użytku)"
            url={`${location.origin}/aktywacja#${PUBLIC_DEMO_CODE}`}
            note="Jeden kod dla wszystkich telefonów na prezentacji. W prawdziwym budynku wyłączony."
          />
        </section>
      )}
    </div>
  );
}

// ───────────────────────── instalacje ─────────────────────────

function InstallationsTab({ installations, reload }: { installations: AdminInstallationView[]; reload: () => void }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(reload, [reload]);
  const revoke = async (i: AdminInstallationView) => {
    if (!confirm(`Cofnąć dostęp dla „${i.name ?? 'Bez nazwy'}”? Telefon straci możliwość wzywania windy, a jego aktywne wezwanie zostanie anulowane.`)) return;
    setError(null);
    try {
      await api.adminRevoke(i.installationId);
      reload();
    } catch (e) {
      setError(message(e, 'Nie udało się cofnąć dostępu.'));
    }
  };
  const active = installations.filter((i) => i.revokedAt === null).length;
  return (
    <div className="admin-sections">
      <section className="panel-section" aria-labelledby="inst-list">
        <h2 id="inst-list">
          Aktywowane telefony ({active} aktywnych z {installations.length})
        </h2>
        {error && <Alert>{error}</Alert>}
        {installations.length === 0 && <div className="hint-text">Żaden telefon nie został jeszcze aktywowany.</div>}
        <div className="list-box">
          {installations.map((i) => (
            <div className="list-row" key={i.installationId}>
              <span className="list-row__text">
                <span className="list-row__value">{i.name ?? 'Bez nazwy'}</span>
                <span className="hint-text hint-text--small">
                  Aktywowano {date(i.activatedAt)} · ostatnio {date(i.lastSeenAt)} · domyślnie {floorName(i.defaultFloor).toLowerCase()}
                </span>
                {i.revokedAt !== null && <span className="badge-revoked">Dostęp cofnięty {date(i.revokedAt)}</span>}
              </span>
              {i.revokedAt === null && (
                <button type="button" className="link-btn link-btn--danger" onClick={() => revoke(i)}>
                  Cofnij dostęp
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
