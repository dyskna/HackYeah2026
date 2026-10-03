/**
 * Ekran mieszkańca bez stanu: ekran główny, wezwanie (przyjęte / jedzie /
 * oczekiwanie / przyjazd), brak połączenia i awaria. Wszystko wynika z widoku
 * serwera i lokalnych pól formularza. Ten sam komponent rysuje podgląd ekranów.
 */
import type { MyCallView, ResidentView } from '../../shared/protocol';
import { DirectionToggle, FloorPicker, Legend, PeopleSlider } from '../components/controls';
import { Alert, Availability, Display, GroupLine, Header, Note, PrimaryButton, SecondaryButton, StatusLine } from '../components/panel';
import type { ShaftMode } from '../components/Shaft';
import { Shaft } from '../components/Shaft';
import { carSentence, etaDisplay, floorAt, floorName, floorShort, occupancySentence, people, peopleGen, reasonText } from '../lib/format';
import { displayFloor } from '../lib/position';

export interface ResidentLayoutProps {
  view: ResidentView;
  online: boolean;
  /** Czas serwera „teraz” (do odliczania ETA). */
  serverNow: number;
  clockOffsetMs: number;
  smooth: boolean;
  call: MyCallView | null;
  floor: number;
  onFloor: (f: number) => void;
  count: number;
  onCount: (n: number) => void;
  direction: 'up' | 'down' | null;
  onDirection: (d: 'up' | 'down') => void;
  sending: boolean;
  onCall: () => void;
  cancelling: boolean;
  onCancel: () => void;
  /** Zmiana liczby osób czeka na odpowiedź serwera. */
  countPending: boolean;
  error: string | null;
  banner: string | null;
  onSettings?: () => void;
}

export function ResidentLayout(p: ResidentLayoutProps) {
  const { view, online, call } = p;
  const b = view.building;
  const fault = view.car.phase === 'fault';
  const mode: ShaftMode = !online ? 'offline' : fault ? 'fault' : 'live';

  return (
    <div className="phone">
      <main className="controls">
        <Header name={b.name} online={online} onSettings={p.onSettings} />
        {!online ? <Offline {...p} /> : fault ? <Fault {...p} /> : call?.status === 'arrived' ? <Arrived {...p} call={call} /> : call ? <Active {...p} call={call} /> : <Home {...p} />}
      </main>
      <Shaft
        minFloor={b.minFloor}
        maxFloor={b.maxFloor}
        capacity={b.capacity}
        car={view.car}
        lamps={view.lamps}
        stops={view.stops}
        userFloor={call ? call.floor : p.floor}
        mode={mode}
        clockOffsetMs={p.clockOffsetMs}
        smooth={p.smooth}
        doorOpenMs={b.doorOpenMs}
        doorCloseMs={b.doorCloseMs}
      />
    </div>
  );
}

// ───────────────────────── ekran główny ─────────────────────────

function Home(p: ResidentLayoutProps) {
  const { view } = p;
  const b = view.building;
  const car = view.car;
  const moving = car.phase === 'moving';
  return (
    <>
      <Display
        label="Kabina"
        value={floorShort(displayFloor(car))}
        valueLabel={floorName(displayFloor(car))}
        arrow={moving ? car.direction : null}
        desc={`${carSentence(car)} ${occupancySentence(car, b.capacity)}`}
      />
      {p.banner && <div className="alert alert--info" role="status">{p.banner}</div>}
      <FloorPicker min={b.minFloor} max={b.maxFloor} value={p.floor} onChange={p.onFloor} />
      {b.directionalCalls && (
        <DirectionToggle value={p.direction} onChange={p.onDirection} canUp={p.floor < b.maxFloor} canDown={p.floor > b.minFloor} />
      )}
      <PeopleSlider value={p.count} max={b.capacity} onChange={p.onCount} />
      <div className="push-bottom">
        {p.error && <Alert>{p.error}</Alert>}
        <Legend />
        <PrimaryButton
          onClick={p.onCall}
          disabled={p.sending || (b.directionalCalls && !p.direction)}
          aria-busy={p.sending || undefined}
        >
          {p.sending ? 'Wysyłanie…' : 'Wezwij windę'}
        </PrimaryButton>
      </div>
    </>
  );
}

// ───────────────────────── aktywne wezwanie ─────────────────────────

function Active(p: ResidentLayoutProps & { call: MyCallView }) {
  const { call, view } = p;
  const waiting = call.status === 'waiting_for_space';
  const accepted = call.status === 'accepted';
  const avail = call.assignment?.availability ?? (view.building.occupancyTelemetry ? 'predicted' : 'unconfirmed');
  const eta = call.eta ? etaDisplay((call.eta.arrivalAt - p.serverNow) / 1000) : null;
  const count = call.passengerCount ?? p.count;

  return (
    <>
      <Display
        label={waiting ? 'Kolejny przejazd za około' : 'Przyjazd za około'}
        value={eta ? eta.led : '--'}
        valueLabel={eta ? `około ${eta.spoken}` : 'czas nieznany'}
        tone={waiting ? 'amber' : 'white'}
        size="digits"
        desc={call.eta ? reasonText(call.eta.reason, view.car) : waiting ? `Oczekiwanie na miejsce dla ${peopleGen(count)}` : 'Liczymy czas przyjazdu'}
      />
      <StatusLine tone={waiting ? 'amber' : 'white'}>
        {waiting ? 'Oczekiwanie na miejsce' : accepted ? 'Wezwanie przyjęte' : 'Winda jedzie do Ciebie'}
      </StatusLine>
      <GroupLine>
        {floorName(call.floor)} · {people(count)}
        {call.direction && ` · ${call.direction === 'up' ? 'w górę' : 'w dół'}`}
      </GroupLine>
      {waiting ? (
        <Note>Najbliższy przejazd nie pomieści Twojej grupy. Zgłoszenie pozostaje aktywne.</Note>
      ) : (
        <Availability kind={avail} />
      )}
      {accepted && !waiting && <Note>Kabina kończy teraz inny przejazd, potem przyjedzie {floorAt(call.floor)}.</Note>}
      <div className="push-bottom">
        {p.countPending && <Note>Sprawdzamy miejsce dla {peopleGen(p.count)}…</Note>}
        {p.error && <Alert>{p.error}</Alert>}
        <PeopleSlider value={p.count} max={view.building.capacity} onChange={p.onCount} />
        <SecondaryButton onClick={p.onCancel} disabled={p.cancelling}>
          {p.cancelling ? 'Anulowanie…' : 'Anuluj wezwanie'}
        </SecondaryButton>
      </div>
    </>
  );
}

function Arrived(p: ResidentLayoutProps & { call: MyCallView }) {
  const { call } = p;
  const confirmed = call.assignment?.availability !== 'unconfirmed';
  const count = call.passengerCount ?? 0;
  return (
    <>
      <Display label="Winda na piętrze" value={floorShort(call.floor)} valueLabel={floorName(call.floor)} tone="green" size="large" desc="Drzwi otwarte" />
      <StatusLine tone="green">Winda przyjechała na Twoje piętro</StatusLine>
      {confirmed ? <GroupLine>Miejsce dla {peopleGen(count)}</GroupLine> : <Availability kind="unconfirmed" />}
      <Note>Jeśli nie wsiądziecie przed zamknięciem drzwi, przydział miejsc wygaśnie i będzie można wezwać windę ponownie.</Note>
    </>
  );
}

// ───────────────────────── brak połączenia, awaria ─────────────────────────

function Offline(p: ResidentLayoutProps) {
  const { call, view } = p;
  return (
    <>
      <Display
        label="Odliczanie wstrzymane"
        value="--"
        valueLabel="czas nieznany"
        tone="dim"
        size="digits"
        desc={`Ostatnio znana pozycja: ${floorName(displayFloor(view.car)).toLowerCase()}`}
      />
      <StatusLine tone="dim">Brak połączenia</StatusLine>
      {call && <GroupLine>{floorName(call.floor)} · {people(call.passengerCount ?? 0)}</GroupLine>}
      <Note>
        {call
          ? 'Pozycja windy może być nieaktualna. Po powrocie sieci pobierzemy aktualną kolejkę i status Twojego wezwania.'
          : 'Pozycja windy może być nieaktualna. Wezwanie wymaga odpowiedzi serwera, więc wyślesz je po powrocie sieci.'}
      </Note>
      {!call && (
        <div className="push-bottom">
          <PrimaryButton disabled>Wezwij windę</PrimaryButton>
        </div>
      )}
    </>
  );
}

function Fault(p: ResidentLayoutProps) {
  const { call } = p;
  return (
    <>
      <Display label="Awaria" value="STOP" valueLabel="Stop" tone="red" size="word" desc="Prognoza czasu przerwana" />
      <StatusLine tone="red">Winda niedostępna</StatusLine>
      {call && <GroupLine>{floorName(call.floor)} · {people(call.passengerCount ?? 0)}</GroupLine>}
      <Note>
        {call
          ? 'Twoje wezwanie pozostaje w kolejce, ale prognoza jest wstrzymana do czasu usunięcia awarii.'
          : 'Nowe wezwania są zablokowane do czasu usunięcia awarii.'}
      </Note>
      <div className="push-bottom">
        {p.error && <Alert>{p.error}</Alert>}
        {call ? (
          <SecondaryButton onClick={p.onCancel} disabled={p.cancelling}>
            Anuluj wezwanie
          </SecondaryButton>
        ) : (
          <PrimaryButton disabled>Wezwij windę</PrimaryButton>
        )}
      </div>
    </>
  );
}
