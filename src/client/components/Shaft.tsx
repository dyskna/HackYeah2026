/**
 * Przekrój szybu: poziomy z tabliczkami, kabina z liną, strzałką kierunku
 * i lampkami zajętości, znaczniki postojów ze źródłem oraz „TY”.
 *
 * Położenie kabiny jest tylko odtwarzaniem stanu serwera: interpolacja odcinka
 * opisanego znacznikami czasu. Przy prefers-reduced-motion kabina przeskakuje
 * między piętrami bez płynnego ruchu.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CarView, LampsView, StopView } from '../../shared/protocol';
import { carSentence, floorName, floorShort } from '../lib/format';
import { positionAt } from '../lib/position';
import { ArrowIcon, PhoneIcon, TargetIcon, WarningIcon } from './icons';

export type ShaftMode = 'live' | 'offline' | 'fault';

interface Props {
  minFloor: number;
  maxFloor: number;
  capacity: number;
  car: CarView;
  lamps: LampsView | null;
  stops: StopView[];
  userFloor: number | null;
  mode: ShaftMode;
  /** Różnica zegara serwera i telefonu. */
  clockOffsetMs: number;
  /** Czasy drzwi z konfiguracji: animacja otwierania i zamykania trwa tyle co w windzie. */
  doorOpenMs: number;
  doorCloseMs: number;
  smooth: boolean;
}

function stopLabel(s: StopView): string {
  const names = s.sources.map((x) => (x === 'app' ? 'aplikacja' : x === 'hall' ? 'przycisk na piętrze' : 'przycisk w kabinie'));
  return `Postój: ${floorName(s.floor)} (${names.join(', ')})`;
}

export function Shaft({ minFloor, maxFloor, capacity, car, lamps, stops, userFloor, mode, clockOffsetMs, smooth, doorOpenMs, doorCloseMs }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const lastPos = useRef<number>(car.floor);
  const floors = useMemo(() => {
    const out: number[] = [];
    for (let f = maxFloor; f >= minFloor; f--) out.push(f);
    return out;
  }, [minFloor, maxFloor]);

  // Animacja: co klatkę ustawiamy zmienną CSS --pos (indeks od góry), bez renderu Reacta.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const apply = (pos: number) => {
      lastPos.current = pos;
      el.style.setProperty('--pos', String(maxFloor - pos));
    };
    if (mode === 'offline') {
      apply(Math.round(lastPos.current));
      return;
    }
    let raf = 0;
    const tick = () => {
      apply(positionAt(car, Date.now() + clockOffsetMs, smooth));
      if (car.phase === 'moving' && smooth) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [car, clockOffsetMs, smooth, mode, maxFloor]);

  const stopByFloor = new Map(stops.map((s) => [s.floor, s]));
  const doorsOpen = car.phase === 'doors_open' || car.phase === 'doors_opening';
  const cabinState = mode === 'offline' ? 'offline' : mode === 'fault' || car.phase === 'fault' ? 'fault' : doorsOpen ? 'open' : 'closed';
  const doorMs = car.phase === 'doors_opening' ? doorOpenMs : car.phase === 'doors_closing' ? doorCloseMs : 0;

  // Wsiadanie i wysiadanie: krótki znacznik „+3” / „−2” przy kabinie.
  const [badge, setBadge] = useState<{ delta: number; key: number } | null>(null);
  const prevOcc = useRef<number | null>(car.occupancy);
  useEffect(() => {
    const prev = prevOcc.current;
    prevOcc.current = car.occupancy;
    if (mode !== 'live' || prev === null || car.occupancy === null || prev === car.occupancy) return;
    setBadge({ delta: car.occupancy - prev, key: Date.now() });
    const id = setTimeout(() => setBadge(null), 2600);
    return () => clearTimeout(id);
  }, [car.occupancy, mode]);
  const arrow = car.phase === 'moving' ? car.direction : null;

  const summary =
    mode === 'offline'
      ? `Przekrój szybu. Ostatnio znana pozycja kabiny: ${floorName(Math.round(lastPos.current))}.`
      : `Przekrój szybu. ${carSentence(car)} ${stops.length ? stops.map(stopLabel).join('. ') + '.' : 'Brak zaplanowanych postojów.'}`;

  return (
    <div className="shaft" ref={root} role="img" aria-label={summary} style={{ ['--floors' as string]: floors.length }}>
      <div className="shaft__cap" />
      {floors.map((f) => {
        const stop = stopByFloor.get(f);
        const you = f === userFloor;
        return (
          <div className="shaft__row" key={f}>
            <div className="shaft__plate-cell">
              <span className="plate" data-you={you || undefined}>
                {floorShort(f)}
              </span>
            </div>
            <div className="shaft__well" />
            <div className="shaft__marks">
              {you ? (
                <span className="you-badge">TY</span>
              ) : stop ? (
                <span className="stop-mark" title={stopLabel(stop)}>
                  {stop.sources.includes('app') && !stop.sources.some((s) => s !== 'app') ? <PhoneIcon /> : <TargetIcon />}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      <span className="rope" aria-hidden />
      <div className="cabin" data-state={cabinState} aria-hidden style={{ ['--door-ms' as string]: `${doorMs}ms` }}>
        {(cabinState === 'closed' || cabinState === 'open') && (
          <>
            <span className="cabin__door cabin__door--l" />
            <span className="cabin__door cabin__door--r" />
          </>
        )}
        {cabinState === 'fault' ? (
          <WarningIcon />
        ) : cabinState === 'offline' ? null : (
          <span className="cabin__body">
            {arrow && <ArrowIcon dir={arrow} size={14} />}
            {lamps ? <Lamps lamps={lamps} capacity={capacity} /> : <span className="cabin__unknown">?</span>}
          </span>
        )}
      </div>
      {badge && (
        <span key={badge.key} className="board-badge" data-kind={badge.delta > 0 ? 'in' : 'out'} aria-hidden>
          {badge.delta > 0 ? `+${badge.delta}` : `−${-badge.delta}`}
        </span>
      )}
    </div>
  );
}

function Lamps({ lamps, capacity }: { lamps: LampsView; capacity: number }) {
  const kinds: ('occupied' | 'mine' | 'free')[] = [];
  for (let i = 0; i < lamps.occupied; i++) kinds.push('occupied');
  for (let i = 0; i < lamps.mine; i++) kinds.push('mine');
  while (kinds.length < capacity) kinds.push('free');
  return (
    <span className="lamps">
      {kinds.slice(0, capacity).map((k, i) => (
        <span key={i} className="lamp" data-kind={k} style={{ ['--i' as string]: i }} />
      ))}
    </span>
  );
}
