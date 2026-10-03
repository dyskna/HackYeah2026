/**
 * Ustawienia: domyślne piętro, nazwa telefonu, przypisany budynek.
 * Wiersz otwiera edycję w miejscu; zapis idzie na serwer (PATCH /api/me).
 */
import { useId, useState } from 'react';
import type { BuildingInfo, InstallationView } from '../../shared/protocol';
import { FloorPicker } from '../components/controls';
import { BackIcon, ChevronIcon } from '../components/icons';
import { Alert, FieldLabel, PrimaryButton, SecondaryButton } from '../components/panel';
import { Api, ApiFailure } from '../lib/api';
import { floorName } from '../lib/format';

const api = new Api();

export function SettingsScreen({
  installation,
  building,
  onBack,
  onSaved,
}: {
  installation: InstallationView;
  building: BuildingInfo;
  onBack: () => void;
  onSaved: (i: InstallationView) => void;
}) {
  const nameId = useId();
  const [editing, setEditing] = useState<'floor' | 'name' | null>(null);
  const [floor, setFloor] = useState(installation.defaultFloor);
  const [name, setName] = useState(installation.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateMe(editing === 'floor' ? { defaultFloor: floor } : { name: name.trim() || null });
      onSaved(r.installation);
      setEditing(null);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Nie udało się zapisać.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setFloor(installation.defaultFloor);
    setName(installation.name ?? '');
    setError(null);
    setEditing(null);
  };

  return (
    <main className="page page--settings">
      <div className="settings-head">
        <button type="button" className="icon-btn" aria-label="Wróć" onClick={editing ? cancel : onBack}>
          <BackIcon />
        </button>
        <h1>{editing === 'floor' ? 'Domyślne piętro' : editing === 'name' ? 'Nazwa telefonu' : 'Ustawienia'}</h1>
      </div>

      {editing === 'floor' && (
        <div className="page__section">
          <FloorPicker min={building.minFloor} max={building.maxFloor} value={floor} onChange={setFloor} label="Wybierz domyślne piętro" large />
        </div>
      )}
      {editing === 'name' && (
        <div className="page__section field">
          <FieldLabel htmlFor={nameId}>Nazwa telefonu (opcjonalnie)</FieldLabel>
          <input id={nameId} className="text-input" type="text" maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="hint-text hint-text--small">Służy tylko do rozpoznania wpisu na liście urządzeń.</div>
        </div>
      )}
      {editing && (
        <div className="push-bottom">
          {error && <Alert>{error}</Alert>}
          <PrimaryButton onClick={save} disabled={busy} aria-busy={busy || undefined}>
            Zapisz
          </PrimaryButton>
          <SecondaryButton onClick={cancel}>Anuluj</SecondaryButton>
        </div>
      )}

      {!editing && (
        <>
          <div className="section-label">Ten telefon</div>
          <div className="list-box">
            <button type="button" className="list-row" onClick={() => setEditing('floor')}>
              <span className="list-row__text">
                <span className="field-label">Domyślne piętro</span>
                <span className="list-row__value">{floorName(installation.defaultFloor)}</span>
              </span>
              <ChevronIcon />
            </button>
            <button type="button" className="list-row" onClick={() => setEditing('name')}>
              <span className="list-row__text">
                <span className="field-label">Nazwa telefonu</span>
                <span className="list-row__value">{installation.name ?? 'Bez nazwy'}</span>
              </span>
              <ChevronIcon />
            </button>
          </div>
          <div className="section-label section-label--gap">Budynek</div>
          <div className="list-box">
            <div className="list-row">
              <span className="list-row__text">
                <span className="field-label">Przypisany budynek</span>
                <span className="list-row__value">{building.name}</span>
              </span>
            </div>
            <div className="list-row">
              <span className="list-row__text">
                <span className="field-label">Adres</span>
                <span className="list-row__value">{building.address}</span>
              </span>
            </div>
          </div>
          <div className="hint-text">Telefon działa tylko w tym budynku. Dostęp do innego wymaga nowego kodu od administratora.</div>
        </>
      )}
    </main>
  );
}
