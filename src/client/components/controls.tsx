/**
 * Sterowanie: wybór piętra (okrągłe przyciski), suwak liczby osób, kierunek, legenda.
 */
import { useId } from 'react';
import { floorName, floorShort, people } from '../lib/format';
import { PersonIcon, PhoneIcon, TargetIcon } from './icons';
import { FieldLabel } from './panel';

/** Piętra w rzędach po 4 od dołu, wyświetlane od góry (jak w makiecie: 8 9 10 / 4–7 / P 1–3). */
function floorRows(min: number, max: number): (number | null)[][] {
  const rows: (number | null)[][] = [];
  for (let f = min; f <= max; f += 4) {
    const row: (number | null)[] = [];
    for (let i = 0; i < 4; i++) row.push(f + i <= max ? f + i : null);
    rows.push(row);
  }
  return rows.reverse();
}

export function FloorPicker({
  min,
  max,
  value,
  onChange,
  label = 'Twoje piętro',
  large = false,
  disabled = false,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (f: number) => void;
  label?: string;
  large?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="floor-picker">
      <FieldLabel id={id}>{label}</FieldLabel>
      <div className="floor-grid" data-large={large || undefined} role="group" aria-labelledby={id}>
        {floorRows(min, max).flat().map((f, i) =>
          f === null ? (
            <span key={`x${i}`} />
          ) : (
            <button
              key={f}
              type="button"
              className="floor-btn"
              aria-pressed={f === value}
              aria-label={floorName(f)}
              disabled={disabled}
              onClick={() => onChange(f)}
            >
              {floorShort(f)}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function PeopleSlider({
  value,
  max,
  onChange,
  disabled = false,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const ticks = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="people">
      <div className="people__head">
        <FieldLabel htmlFor={id}>Ile osób jedzie?</FieldLabel>
        <span className="people__count" aria-hidden>
          {people(value)}
        </span>
      </div>
      <div className="people__icons" aria-hidden>
        {ticks.map((n) => (
          <PersonIcon key={n} filled={n <= value} />
        ))}
      </div>
      <input
        id={id}
        className="people__range"
        type="range"
        min={1}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-valuetext={people(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="people__ticks" aria-hidden>
        {ticks.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

/** „W górę” / „W dół” – tylko gdy instalacja rozróżnia kierunki wezwań. */
export function DirectionToggle({
  value,
  onChange,
  canUp,
  canDown,
}: {
  value: 'up' | 'down' | null;
  onChange: (d: 'up' | 'down') => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const id = useId();
  return (
    <div className="direction">
      <FieldLabel id={id}>Kierunek</FieldLabel>
      <div className="dir-toggle" role="group" aria-labelledby={id}>
        <button type="button" aria-pressed={value === 'up'} disabled={!canUp} onClick={() => onChange('up')}>
          W górę
        </button>
        <button type="button" aria-pressed={value === 'down'} disabled={!canDown} onClick={() => onChange('down')}>
          W dół
        </button>
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <ul className="legend" aria-label="Legenda szybu">
      <li>
        <span className="legend__lamp" data-kind="occupied" aria-hidden />
        zajęte
      </li>
      <li>
        <span className="legend__lamp" data-kind="free" aria-hidden />
        wolne
      </li>
      <li>
        <TargetIcon /> przycisk
      </li>
      <li>
        <PhoneIcon /> aplikacja
      </li>
    </ul>
  );
}
