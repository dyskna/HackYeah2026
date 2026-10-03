/**
 * Podgląd ekranów (tylko w trybie deweloperskim, /podglad?ekran=…).
 * Dane odpowiadają makietom z folderu design/, a ekrany rysuje ten sam
 * komponent co w aplikacji. Służy do porównania z makietami i zrzutów.
 */
import { DEMO_BUILDING } from '../../shared/config';
import type { CarView, LampsView, MyCallView, ResidentView, StopView } from '../../shared/protocol';
import { buildingInfo } from '../../engine/view';
import type { ResidentLayoutProps } from './ResidentLayout';
import { ResidentLayout } from './ResidentLayout';

const HOUR = 3600_000;
const now = Date.now();

/** Ruch „zamrożony” w połowie odcinka (odcinek rozciągnięty na 2 godziny). */
function moving(from: number, to: number, occupancy: number | null): CarView {
  return { phase: 'moving', floor: from, targetFloor: to, direction: to > from ? 'up' : 'down', phaseStartedAt: now - HOUR, phaseEndsAt: now + HOUR, occupancy, fault: null };
}

function still(floor: number, occupancy: number | null, phase: CarView['phase'] = 'idle'): CarView {
  return { phase, floor, targetFloor: null, direction: null, phaseStartedAt: now, phaseEndsAt: null, occupancy, fault: null };
}

function call(status: MyCallView['status'], seconds: number | null, extra: Partial<MyCallView> = {}): MyCallView {
  return {
    callId: 'c1',
    requestId: 'r1',
    floor: 4,
    direction: null,
    passengerCount: 2,
    status,
    assignment: { tripIndex: status === 'waiting_for_space' ? 1 : 0, seats: 2, availability: 'predicted' },
    createdAt: now - 10_000,
    eta: seconds === null ? null : { arrivalAt: now + seconds * 1000, computedAt: now, seconds, reason: { kind: 'stop_added', floor: 2 } },
    ...extra,
  };
}

function view(car: CarView, lamps: LampsView | null, stops: StopView[], myCall: MyCallView | null, cfg = DEMO_BUILDING): ResidentView {
  return { version: 1, serverNow: now, building: buildingInfo(cfg), car, lamps, stops, myCall };
}

const hall2: StopView = { floor: 2, sources: ['hall'], mine: false };
const mine4: StopView = { floor: 4, sources: ['app'], mine: true };

type Screen = { title: string; props: Partial<ResidentLayoutProps> & { view: ResidentView } };

export const SCREENS: Record<string, Screen> = {
  glowny: {
    title: 'Ekran główny',
    props: { view: view(moving(7, 6, 2), { occupied: 2, mine: 0, free: 4 }, [hall2], null) },
  },
  jedzie: {
    title: 'Winda jedzie do Ciebie',
    props: { view: view(moving(1, 2, 2), { occupied: 2, mine: 2, free: 2 }, [hall2, mine4], call('assigned', 20)), count: 2 },
  },
  oczekiwanie: {
    title: 'Oczekiwanie na miejsce',
    props: {
      view: view(moving(2, 3, 5), { occupied: 5, mine: 0, free: 1 }, [], call('waiting_for_space', 55, { eta: { arrivalAt: now + 55_000, computedAt: now, seconds: 55, reason: { kind: 'waiting_for_space', count: 2 } } })),
      count: 2,
    },
  },
  przyjazd: {
    title: 'Winda przyjechała',
    props: { view: view(still(4, 2, 'doors_open'), { occupied: 2, mine: 2, free: 2 }, [], call('arrived', 0, { assignment: { tripIndex: 0, seats: 2, availability: 'confirmed' } })) },
  },
  'brak-polaczenia': {
    title: 'Brak połączenia',
    props: { view: view(still(3, 2), { occupied: 2, mine: 0, free: 4 }, [], call('assigned', 30)), online: false },
  },
  awaria: {
    title: 'Awaria',
    props: {
      view: view({ ...still(6, 2, 'fault'), fault: { since: now, reason: 'Test', interruptedPhase: 'idle', progress: 0 } }, { occupied: 2, mine: 0, free: 4 }, [], null),
    },
  },
  przyjete: {
    title: 'Wezwanie przyjęte (stan spoza makiet)',
    props: { view: view(moving(6, 7, 1), { occupied: 1, mine: 0, free: 5 }, [{ floor: 9, sources: ['car'], mine: false }, mine4], call('accepted', 38, { eta: { arrivalAt: now + 38_000, computedAt: now, seconds: 38, reason: { kind: 'route' } } })), count: 2 },
  },
  niepotwierdzona: {
    title: 'Dostępność miejsc niepotwierdzona (stan spoza makiet)',
    props: {
      view: view(moving(1, 2, null), null, [hall2, mine4], call('assigned', 20, { assignment: { tripIndex: 0, seats: 2, availability: 'unconfirmed' } }), { ...DEMO_BUILDING, occupancyTelemetry: false }),
      count: 2,
    },
  },
  'za-duza-grupa': {
    title: 'Grupa większa niż pojemność (stan spoza makiet)',
    props: {
      view: view(still(0, 0), { occupied: 0, mine: 0, free: 6 }, [], null),
      count: 6,
      error: 'Grupa jest większa niż pojemność kabiny (6 osób). Podzielcie się na kilka przejazdów.',
    },
  },
  kierunek: {
    title: 'Wybór kierunku (stan spoza makiet)',
    props: { view: view(still(0, 0), { occupied: 0, mine: 0, free: 6 }, [], null, { ...DEMO_BUILDING, directionalCalls: true }), direction: 'down' },
  },
};

const noop = () => {};

export default function Gallery() {
  const params = new URLSearchParams(location.search);
  const id = params.get('ekran');
  const full = params.has('pelny');
  const screen = id ? SCREENS[id] : null;
  if (screen) {
    const props: ResidentLayoutProps = {
      online: true,
      serverNow: now,
      clockOffsetMs: 0,
      smooth: true,
      call: screen.props.view.myCall,
      floor: 4,
      onFloor: noop,
      count: 1,
      onCount: noop,
      direction: null,
      onDirection: noop,
      sending: false,
      onCall: noop,
      cancelling: false,
      onCancel: noop,
      countPending: false,
      error: null,
      banner: null,
      onSettings: noop,
      ...screen.props,
    };
    return full ? (
      <ResidentLayout {...props} />
    ) : (
      <div className="preview-frame">
        <ResidentLayout {...props} />
      </div>
    );
  }
  return (
    <main className="page">
      <h1>Podgląd ekranów</h1>
      <ul>
        {Object.entries(SCREENS).map(([k, s]) => (
          <li key={k}>
            <a href={`/podglad?ekran=${k}`}>{s.title}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
