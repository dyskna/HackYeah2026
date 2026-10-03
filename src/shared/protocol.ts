/**
 * Kształty danych wymieniane między serwerem a klientami (HTTP i WebSocket).
 * Widok mieszkańca nie zawiera identyfikatorów ani nazw cudzych urządzeń,
 * ani liczebności cudzych grup.
 */
import type { NoticeKind } from '../engine/core';
import type { Assignment, CallStatus, CarPhase, CoreState, Direction, Eta } from './model';

export interface BuildingInfo {
  id: string;
  name: string;
  address: string;
  minFloor: number;
  maxFloor: number;
  capacity: number;
  directionalCalls: boolean;
  /** Czy instalacja dostarcza dane o zajętości kabiny. */
  occupancyTelemetry: boolean;
  /** Czasy z konfiguracji, potrzebne do płynnej animacji kabiny. */
  travelPerFloorMs: number;
  doorOpenMs: number;
  doorCloseMs: number;
}

export interface CarView {
  phase: CarPhase;
  floor: number;
  targetFloor: number | null;
  direction: Direction | null;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  occupancy: number | null;
  fault: { since: number; reason: string; interruptedPhase: CarPhase; progress: number } | null;
}

/** Lampki zajętości w kabinie; null, gdy brak danych o zajętości. */
export interface LampsView {
  occupied: number;
  /** Miejsca przydzielone grupie tego telefonu w bieżącym przejeździe. */
  mine: number;
  free: number;
}

export type StopSource = 'app' | 'hall' | 'car';

export interface StopView {
  floor: number;
  sources: StopSource[];
  /** Postój wynika (także) z wezwania tego telefonu. */
  mine: boolean;
}

export interface MyCallView {
  callId: string;
  requestId: string | null;
  floor: number;
  direction: Direction | null;
  passengerCount: number | null;
  status: CallStatus;
  assignment: Assignment | null;
  createdAt: number;
  eta: Eta | null;
}

export interface ResidentView {
  version: number;
  serverNow: number;
  building: BuildingInfo;
  car: CarView;
  lamps: LampsView | null;
  stops: StopView[];
  myCall: MyCallView | null;
}

/** Pełny stan dla administratora i panelu symulatora (zaufany odbiorca). */
export interface AdminPayload {
  version: number;
  core: CoreState;
  sim: { phase: string; floor: number; passengers: number; hallWaiting: { floor: number; count: number }[] };
}

export interface Notice {
  kind: NoticeKind;
  callId: string | null;
}

/** Wiadomości serwer → klient. */
export type ServerMessage =
  | { type: 'snapshot'; view: ResidentView }
  | { type: 'update'; view: ResidentView }
  | { type: 'notice'; version: number; notice: Notice }
  | ({ type: 'admin'; serverNow: number } & AdminPayload)
  | { type: 'pong'; serverNow: number }
  /** Administrator cofnął dostęp; serwer zaraz zamknie połączenie (kod 4001). */
  | { type: 'revoked' };

/** Wiadomości klient → serwer (zmiany stanu idą przez HTTP). */
export type ClientMessage = { type: 'sync' } | { type: 'ping' };

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'bad_origin'
  | 'rate_limited'
  | 'payload_too_large'
  | 'invalid_json'
  | 'not_found'
  | 'code_invalid'
  | 'code_expired'
  | 'code_used'
  | 'admin_disabled'
  | 'revoked'
  | (string & {});

export interface ApiError {
  error: ApiErrorCode;
  message: string;
}

export interface InstallationView {
  installationId: string;
  name: string | null;
  defaultFloor: number;
  activatedAt: number;
}

export interface AdminInstallationView extends InstallationView {
  revokedAt: number | null;
  lastSeenAt: number | null;
}

export interface ActivationCodeView {
  code: string;
  url: string;
  expiresAt: number;
}
