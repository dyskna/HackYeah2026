/**
 * Elementy panelu windy: nagłówek, wyświetlacz LED, linia stanu, przyciski.
 */
import type { ReactNode } from 'react';
import { ArrowIcon, CheckIcon, SettingsIcon, UnknownIcon } from './icons';

export type Tone = 'white' | 'amber' | 'green' | 'red' | 'dim';

export function Header({ name, online, onSettings }: { name: string; online: boolean; onSettings?: () => void }) {
  return (
    <header className="header">
      <div className="header__text">
        <div className="header__title">{name}</div>
        <div className="conn" role="status">
          <span className="conn__dot" data-tone={online ? 'green' : 'amber'} aria-hidden />
          <span>{online ? 'Połączono' : 'Brak sieci'}</span>
        </div>
      </div>
      {onSettings && (
        <a
          href="/ustawienia"
          className="icon-btn"
          aria-label="Ustawienia"
          onClick={(e) => {
            e.preventDefault();
            onSettings();
          }}
        >
          <SettingsIcon />
        </a>
      )}
    </header>
  );
}

export type LedSize = 'normal' | 'digits' | 'large' | 'word' | 'activation';

/** Czarny wyświetlacz z podpisem, dużą wartością (Doto) i opisem. */
export function Display({
  label,
  value,
  arrow,
  desc,
  tone = 'white',
  size = 'normal',
  valueLabel,
}: {
  label: string;
  value: string;
  arrow?: 'up' | 'down' | null;
  desc?: ReactNode;
  tone?: Tone;
  size?: LedSize;
  /** Tekst dla czytnika ekranu zamiast „20 s” / „STOP”. */
  valueLabel?: string;
}) {
  return (
    <div className="display" data-tone={tone}>
      <div className="display__label">{label}</div>
      <div className="display__value" data-size={size}>
        <span aria-hidden={valueLabel ? true : undefined}>{value}</span>
        {valueLabel && <span className="sr-only">{valueLabel}</span>}
        {arrow && <ArrowIcon dir={arrow} />}
      </div>
      {desc && <div className="display__desc">{desc}</div>}
    </div>
  );
}

/** Lampka i nazwa stanu, np. „Winda jedzie do Ciebie”. Kolor zawsze z tekstem. */
export function StatusLine({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className="status">
      <span className="status__lamp" data-tone={tone} aria-hidden />
      <span className="status__text">{children}</span>
    </div>
  );
}

export function GroupLine({ children }: { children: ReactNode }) {
  return <div className="group-line">{children}</div>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

/** Dostępność miejsc: przewidywana / potwierdzona (✓) albo niepotwierdzona (?). */
export function Availability({ kind }: { kind: 'predicted' | 'confirmed' | 'unconfirmed' }) {
  if (kind === 'unconfirmed') {
    return (
      <div className="avail" data-kind="unconfirmed">
        <UnknownIcon />
        <span>Dostępność miejsc niepotwierdzona</span>
      </div>
    );
  }
  return (
    <div className="avail" data-kind={kind}>
      <CheckIcon />
      <span>{kind === 'confirmed' ? 'Miejsce dla Twojej grupy potwierdzone' : 'Przewidywane miejsce dla Twojej grupy'}</span>
    </div>
  );
}

export function PrimaryButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="btn-primary" {...p}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="btn-secondary" {...p}>
      {children}
    </button>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      {children}
    </div>
  );
}

export function FieldLabel({ children, id, htmlFor }: { children: ReactNode; id?: string; htmlFor?: string }) {
  return htmlFor ? (
    <label className="field-label" htmlFor={htmlFor} id={id}>
      {children}
    </label>
  ) : (
    <div className="field-label" id={id}>
      {children}
    </div>
  );
}
