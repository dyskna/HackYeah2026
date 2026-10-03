/**
 * Aktywacja kodem z QR: start → (serwer tworzy instalację) → sukces z wyborem
 * domyślnego piętra i nazwą telefonu. Kod nieprawidłowy, wygasły albo wykorzystany
 * daje konkretny komunikat i nie pozwala przejść do zamawiania windy.
 * Kod jest w części # adresu, więc nie trafia do logów serwera.
 */
import { useEffect, useId, useState } from 'react';
import type { BuildingInfo } from '../../shared/protocol';
import { FloorPicker } from '../components/controls';
import { Alert, Display, FieldLabel, PrimaryButton } from '../components/panel';
import { Api, ApiFailure } from '../lib/api';
import { peopleWord } from '../lib/format';

const api = new Api();

type CodeError = 'code_invalid' | 'code_expired' | 'code_used';

const ERRORS: Record<CodeError, [string, string]> = {
  code_expired: ['Kod wygasł', 'Ten kod aktywacyjny stracił ważność.'],
  code_invalid: ['Kod jest nieprawidłowy', 'Nie rozpoznajemy tego kodu. Sprawdź, czy skanujesz kod otrzymany od administratora.'],
  code_used: ['Kod został już wykorzystany', 'Każdy kod aktywuje tylko jeden telefon.'],
};

function asCodeError(e: unknown): CodeError | null {
  return e instanceof ApiFailure && e.code in ERRORS ? (e.code as CodeError) : null;
}

export function ActivationScreen({ onDone }: { onDone: () => void }) {
  const [code] = useState(() => decodeURIComponent(location.hash.slice(1)));
  const [building, setBuilding] = useState<BuildingInfo | null>(null);
  const [reusable, setReusable] = useState(false);
  const [codeError, setCodeError] = useState<CodeError | null>(code ? null : 'code_invalid');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    if (!code) return;
    api.activationInfo(code).then(
      (r) => {
        setBuilding(r.building);
        setReusable(r.reusable);
      },
      (e) => (asCodeError(e) ? setCodeError(asCodeError(e)) : setError(e instanceof ApiFailure ? e.message : 'Nie udało się sprawdzić kodu.')),
    );
  }, [code]);

  const activate = async () => {
    if (!building) return;
    setBusy(true);
    setError(null);
    try {
      await api.activate(code, null, building.minFloor);
      // Kod jest zużyty: usuwamy go z adresu (i historii przeglądarki).
      history.replaceState(null, '', '/aktywacja');
      setActivated(true);
    } catch (e) {
      if (asCodeError(e)) setCodeError(asCodeError(e));
      else setError(e instanceof ApiFailure ? e.message : 'Nie udało się aktywować telefonu.');
    } finally {
      setBusy(false);
    }
  };

  if (codeError) return <CodeErrorView kind={codeError} />;
  if (activated && building) return <Success building={building} onDone={onDone} />;

  return (
    <main className="page">
      <div className="field-label">Aktywacja dostępu</div>
      {building ? (
        <>
          <div className="tile">
            <span className="rivet" aria-hidden />
            <span className="rivet" aria-hidden />
            <span className="rivet" aria-hidden />
            <span className="rivet" aria-hidden />
            <div className="field-label">Dźwig osobowy</div>
            <div className="tile__big">
              {building.capacity} {peopleWord(building.capacity)}
            </div>
            <div className="group-line">
              {building.minFloor === 0 ? `Parter + ${building.maxFloor} pięter` : `Piętra ${building.minFloor}–${building.maxFloor}`}
            </div>
          </div>
          <h1 className="page__title">{building.name}</h1>
          <div className="page__address">{building.address}</div>
          <p className="page__lead">Aktywuj ten telefon, aby wzywać windę i śledzić jej położenie w budynku.</p>
        </>
      ) : (
        !error && <p role="status">Sprawdzamy kod…</p>
      )}
      <div className="push-bottom">
        {error && <Alert>{error}</Alert>}
        <div className="hint-text">
          {reusable
            ? 'Kod demonstracyjny: ten sam kod QR aktywuje każdy telefon w budynku.'
            : 'Kod od administratora jest jednorazowy. Po użyciu nie aktywuje kolejnego telefonu.'}
        </div>
        <PrimaryButton onClick={activate} disabled={!building || busy} aria-busy={busy || undefined}>
          {busy ? 'Aktywowanie…' : 'Aktywuj dostęp'}
        </PrimaryButton>
      </div>
    </main>
  );
}

function Success({ building, onDone }: { building: BuildingInfo; onDone: () => void }) {
  const nameId = useId();
  const [floor, setFloor] = useState(building.minFloor);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateMe({ defaultFloor: floor, name: name.trim() || null });
      onDone();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Nie udało się zapisać ustawień.');
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <Display label={building.name} value="OK" valueLabel="Aktywacja udana" tone="green" size="activation" desc="Telefon ma dostęp do windy w tym budynku" />
      <h1 className="page__title page__title--near">Telefon został dodany</h1>
      <div className="page__section">
        <FloorPicker min={building.minFloor} max={building.maxFloor} value={floor} onChange={setFloor} label="Wybierz domyślne piętro" large />
      </div>
      <div className="page__section field">
        <FieldLabel htmlFor={nameId}>Nazwa telefonu (opcjonalnie)</FieldLabel>
        <input id={nameId} className="text-input" type="text" maxLength={40} autoComplete="off" placeholder="np. Telefon Natalii" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="hint-text hint-text--small">Służy tylko do rozpoznania wpisu na liście urządzeń.</div>
      </div>
      <div className="push-bottom">
        {error && <Alert>{error}</Alert>}
        <PrimaryButton onClick={save} disabled={busy} aria-busy={busy || undefined}>
          Przejdź do aplikacji
        </PrimaryButton>
      </div>
    </main>
  );
}

function CodeErrorView({ kind }: { kind: CodeError }) {
  const [title, desc] = ERRORS[kind];
  return (
    <main className="page">
      <Display label="Aktywacja" value="STOP" valueLabel="Stop" tone="red" size="activation" desc="Ten telefon nie został dodany" />
      <h1 className="page__title page__title--near">{title}</h1>
      <p className="page__lead page__lead--near">{desc}</p>
      <div className="tile tile--next">
        <div className="field-label">Co dalej</div>
        <div>Poproś administratora budynku o nowy kod QR i zeskanuj go aparatem telefonu.</div>
      </div>
      <div className="push-bottom hint-text">Bez aktywnego kodu nie można wzywać windy z tego telefonu.</div>
    </main>
  );
}
