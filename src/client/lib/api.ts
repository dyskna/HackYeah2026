/**
 * Klient HTTP API. Wezwanie windy jest idempotentne: identyfikator żądania
 * powstaje raz na jedno naciśnięcie „Wezwij windę”, a ponowienia po błędzie
 * sieci wysyłają ten sam requestId (serwer zwraca istniejące zgłoszenie).
 * Ekran przechodzi w oczekiwanie dopiero po odpowiedzi serwera.
 */
import type { ApiError, BuildingInfo, InstallationView, MyCallView, ResidentView } from '../../shared/protocol';
import type { Direction } from '../../shared/model';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  /** Błąd sieci (brak odpowiedzi serwera) – można ponowić. */
  get network(): boolean {
    return this.status === 0;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  fetch?: FetchLike;
  base?: string;
  sleep?: (ms: number) => Promise<void>;
  newRequestId?: () => string;
}

export class Api {
  private f: FetchLike;
  private base: string;
  private sleep: (ms: number) => Promise<void>;
  private newRequestId: () => string;

  constructor(opts: ApiOptions = {}) {
    this.f = opts.fetch ?? ((i, init) => fetch(i, init));
    this.base = opts.base ?? '';
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.newRequestId = opts.newRequestId ?? (() => crypto.randomUUID());
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(this.base + path, {
        method,
        // Domyślne credentials: 'same-origin' – ciasteczko sesji idzie tylko do tej samej domeny.
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiFailure(0, 'network', 'Brak połączenia z serwerem.');
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const e = (data ?? {}) as Partial<ApiError>;
      throw new ApiFailure(res.status, e.error ?? 'http_error', e.message ?? `Błąd ${res.status}`);
    }
    return data as T;
  }

  /**
   * Wezwanie windy. Ponawia przy błędzie sieci z tym samym requestId.
   * Zwraca zgłoszenie dopiero po akceptacji serwera.
   */
  async callElevator(
    input: { floor: number; passengerCount: number; direction?: Direction | null },
    retries = 3,
  ): Promise<{ call: MyCallView; created: boolean; requestId: string }> {
    const requestId = this.newRequestId();
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.req<{ call: MyCallView; created: boolean }>('POST', '/api/calls', { requestId, ...input });
        return { ...r, requestId };
      } catch (e) {
        if (!(e instanceof ApiFailure) || !e.network || attempt >= retries) throw e;
        await this.sleep(500 * 2 ** attempt);
      }
    }
  }

  setPassengerCount(callId: string, passengerCount: number) {
    return this.req<{ call: MyCallView }>('PATCH', `/api/calls/${encodeURIComponent(callId)}`, { passengerCount });
  }

  cancelCall(callId: string) {
    return this.req<{ call: MyCallView }>('DELETE', `/api/calls/${encodeURIComponent(callId)}`);
  }

  state() {
    return this.req<ResidentView>('GET', '/api/state');
  }

  me() {
    return this.req<{ installation: InstallationView; building: BuildingInfo }>('GET', '/api/me');
  }

  updateMe(patch: { name?: string | null; defaultFloor?: number }) {
    return this.req<{ installation: InstallationView }>('PATCH', '/api/me', patch);
  }

  activationInfo(code: string) {
    return this.req<{ building: BuildingInfo; expiresAt: number; reusable: boolean }>('GET', `/api/activation/${encodeURIComponent(code)}`);
  }

  activate(code: string, name: string | null, defaultFloor: number) {
    return this.req<{ installation: InstallationView; building: BuildingInfo }>('POST', '/api/activation', { code, name, defaultFloor });
  }
}
