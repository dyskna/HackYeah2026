/** Ikony z makiet (kwadratowe zakończenia linii, bez zaokrągleń). */
import type { SVGProps } from 'react';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  'aria-hidden': true,
  focusable: false,
};

type P = SVGProps<SVGSVGElement> & { size?: number };

export function ArrowIcon({ dir, size = 40, strokeWidth = 4, ...p }: P & { dir: 'up' | 'down' }) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={strokeWidth} {...p}>
      <polyline points={dir === 'down' ? '5 9 12 16 19 9' : '5 15 12 8 19 15'} />
    </svg>
  );
}

export function SettingsIcon({ size = 24, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2} {...p}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <rect x="7" y="4" width="4" height="6" className="icon-fill-bg" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <rect x="13" y="14" width="4" height="6" className="icon-fill-bg" />
    </svg>
  );
}

export function BackIcon({ size = 22, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={3} {...p}>
      <polyline points="15 5 8 12 15 19" />
    </svg>
  );
}

export function ChevronIcon({ size = 18, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={3} {...p}>
      <polyline points="9 5 16 12 9 19" />
    </svg>
  );
}

export function CheckIcon({ size = 16, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={3} {...p}>
      <polyline points="4 12 10 18 20 6" />
    </svg>
  );
}

/** Niepotwierdzone: znak zapytania w kwadracie. */
export function UnknownIcon({ size = 16, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.5} {...p}>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14" />
      <line x1="12" y1="17" x2="12" y2="17.5" />
    </svg>
  );
}

/** Postój z przycisku: tarcza. */
export function TargetIcon({ size = 12, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.5} {...p}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

/** Postój z aplikacji: telefon. */
export function PhoneIcon({ size = 12, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.5} {...p}>
      <rect x="7" y="3" width="10" height="18" />
      <line x1="11" y1="17.5" x2="13" y2="17.5" />
    </svg>
  );
}

export function WarningIcon({ size = 26, ...p }: P) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2} {...p}>
      <path d="M12 3 L22 20 H2 Z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.5" />
    </svg>
  );
}

/** Sylwetka osoby nad suwakiem. */
export function PersonIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="26" height="28" viewBox="0 0 26 28" className={filled ? 'person person--on' : 'person'} strokeWidth={2} aria-hidden focusable={false}>
      <circle cx="13" cy="7" r="5" />
      <path d="M3 27 V20 a10 8 0 0 1 20 0 V27 Z" />
    </svg>
  );
}
