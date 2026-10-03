// Test end-to-end API i WebSocket na działającym serwerze.
// Użycie: `npm run dev` w jednym terminalu, potem `npm run e2e` (domyślnie http://localhost:5173).
// Zmienne: BASE (domyślnie http://localhost:5173), ADMIN_PASSWORD (domyślnie z .dev.vars).
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? "http://localhost:5173";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ??
  readFileSync('.dev.vars', 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

function client(name) {
  const jar = {};
  return {
    name,
    jar,
    cookie: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    async req(method, path, body, { origin = BASE } = {}) {
      const headers = { cookie: this.cookie() };
      if (origin) headers.origin = origin;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        jar[kv.slice(0, i)] = kv.slice(i + 1);
      }
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    },
    socket(path = '/ws') {
      const msgs = [];
      const ws = new WebSocket(BASE.replace('http', 'ws') + path, { headers: { cookie: this.cookie(), origin: BASE } });
      const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e.code)));
      ws.addEventListener('message', (e) => msgs.push(JSON.parse(e.data)));
      const opened = new Promise((r, j) => {
        ws.addEventListener('open', r);
        ws.addEventListener('error', j);
      });
      return { ws, msgs, opened, closed, last: (t) => [...msgs].reverse().find((m) => !t || m.type === t) };
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(50);
  }
  return fn();
}

const admin = client('admin');
const A = client('A');
const B = client('B');

// ── administrator ──
check('admin: złe hasło odrzucone', (await admin.req('POST', '/api/admin/login', { password: 'zle' })).status === 401);
check('admin: logowanie', (await admin.req('POST', '/api/admin/login', { password: ADMIN_PASSWORD })).status === 200);
check('admin: reset symulacji', (await admin.req('POST', '/api/admin/reset')).status === 200);
await admin.req('POST', '/api/admin/sim', { type: 'config', patch: { ambientTraffic: false } });
const codeA = (await admin.req('POST', '/api/admin/codes', { ttlHours: 1 })).data;
const codeB = (await admin.req('POST', '/api/admin/codes', { ttlHours: 1 })).data;
check('admin: kod QR z odnośnikiem', codeA?.url?.includes('/aktywacja#demo.'), codeA?.url);
check('bez sesji admina brak dostępu', (await A.req('POST', '/api/admin/codes', {})).status === 401);

// ── aktywacja ──
const info = await A.req('GET', `/api/activation/${encodeURIComponent(codeA.code)}`);
check('aktywacja: dane budynku bez zużycia kodu', info.status === 200 && info.data.building.name === 'Budynek demonstracyjny');
const actA = await A.req('POST', '/api/activation', { code: codeA.code, name: 'Telefon A', defaultFloor: 4 });
check('aktywacja A', actA.status === 201 && !!A.jar['__Host-winda_sid']);
check('sekret sesji nie wraca w treści odpowiedzi', !JSON.stringify(actA.data).includes(A.jar['__Host-winda_sid'].split('.')[2]));
const reuse = await B.req('POST', '/api/activation', { code: codeA.code });
check('kod jednorazowy: drugi telefon odrzucony', reuse.status === 410 && reuse.data.error === 'code_used');
check('kod nieprawidłowy', (await B.req('GET', '/api/activation/demo.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).data?.error === 'code_invalid');
check('aktywacja B', (await B.req('POST', '/api/activation', { code: codeB.code, name: 'Telefon B' })).status === 201);
const instA = actA.data.installation.installationId;

// ── ochrona ──
check('brak sesji: 401', (await client('X').req('GET', '/api/state')).status === 401);
check('obce pochodzenie: 403', (await A.req('POST', '/api/calls', { requestId: 'x', floor: 1, passengerCount: 1 }, { origin: 'https://evil.example' })).status === 403);
const forged = client('F');
forged.jar['__Host-winda_sid'] = `demo.${instA}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
check('podrobiony sekret sesji: 401', (await forged.req('GET', '/api/state')).status === 401);

// ── WebSocket ──
const wsA = A.socket();
const wsB = B.socket();
const wsAdmin = admin.socket('/ws?role=admin');
await Promise.all([wsA.opened, wsB.opened, wsAdmin.opened]);
check('WS: snapshot po połączeniu', !!(await until(() => wsA.last('snapshot'))));
const evil = client('E');
evil.jar = A.jar;
const wsEvil = new WebSocket(BASE.replace('http', 'ws') + '/ws', { headers: { cookie: A.cookie(), origin: 'https://evil.example' } });
check('WS z obcego pochodzenia odrzucony', await new Promise((r) => { wsEvil.addEventListener('error', () => r(true)); wsEvil.addEventListener('open', () => r(false)); }));

// ── wezwanie i idempotencja ──
const first = await A.req('POST', '/api/calls', { requestId: 'r-1', floor: 4, passengerCount: 2, buildingId: 'inny-budynek' });
check('wezwanie przyjęte (201)', first.status === 201 && first.data.created === true, `ETA ${first.data?.call?.eta?.seconds} s`);
const again = await A.req('POST', '/api/calls', { requestId: 'r-1', floor: 4, passengerCount: 2 });
check('ponowienie z tym samym requestId: to samo zgłoszenie (200)', again.status === 200 && again.data.call.callId === first.data.call.callId);
const second = await A.req('POST', '/api/calls', { requestId: 'r-2', floor: 6, passengerCount: 1 });
check('jedno aktywne wezwanie na telefon', second.status === 409 && second.data.error === 'active_call_exists');
check('grupa ponad pojemność: komunikat o podziale', (await B.req('POST', '/api/calls', { requestId: 'b-big', floor: 3, passengerCount: 7 })).data?.error === 'group_too_large');

const viewB = (await until(() => wsB.last('update')?.view.stops.length && wsB.last('update'))).view;
check('B widzi postój na 4. ze źródłem „aplikacja”', viewB.stops.some((s) => s.floor === 4 && s.sources.includes('app') && !s.mine));
check('B nie widzi cudzego zgłoszenia ani identyfikatora A', viewB.myCall === null && !JSON.stringify(wsB.msgs).includes(instA) && !JSON.stringify(viewB).includes('Telefon A'));

// ── przycisk piętrowy z panelu ──
// Ktoś wzywa z 6.: kabina jedzie najpierw tam, A z 4. zabiera w drodze w dół.
await admin.req('POST', '/api/admin/sim', { type: 'hall_press', floor: 6, dests: [0] });
const upd = await until(() => wsA.msgs.find((m) => m.type === 'update' && m.view.myCall?.eta?.reason?.kind === 'stop_added'));
check('A: ETA przeliczone, „Dodano postój na 6. piętrze”', !!upd, upd ? `ETA ${upd.view.myCall.eta.seconds} s` : '');
const versions = wsA.msgs.filter((m) => m.view).map((m) => m.view.version);
check('wersje rosną', versions.every((v, i) => i === 0 || v >= versions[i - 1]));
check('admin WS dostaje pełny stan', !!wsAdmin.last('admin')?.core);

// ── anulowanie ──
check('B nie anuluje cudzego wezwania', (await B.req('DELETE', `/api/calls/${first.data.call.callId}`)).status === 403);

// ── ponowne połączenie ──
wsA.ws.close();
await wsA.closed;
const wsA2 = A.socket();
await wsA2.opened;
const snap = await until(() => wsA2.last('snapshot'));
check('po ponownym połączeniu pełny stan z własnym wezwaniem', snap?.view.myCall?.callId === first.data.call.callId);
check('GET /api/state zwraca pełny stan', (await A.req('GET', '/api/state')).data?.myCall?.callId === first.data.call.callId);

// ── cofnięcie dostępu ──
const instB = (await admin.req('GET', '/api/admin/installations')).data.find((i) => i.name === 'Telefon B');
check('admin widzi listę instalacji z nazwami', !!instB);
await admin.req('DELETE', `/api/admin/installations/${instB.installationId}`);
const revokedMsg = await until(() => wsB.msgs.find((m) => m.type === 'revoked'));
const closeCode = await Promise.race([wsB.closed, sleep(1500).then(() => 'zamknięcie w toku')]);
check('cofnięcie dostępu: telefon dostaje „revoked”', !!revokedMsg, `zamknięcie: ${closeCode}`);
check('po cofnięciu dostępu: 401', (await B.req('GET', '/api/state')).data?.error === 'revoked');

// ── awaria ──
await admin.req('POST', '/api/admin/sim', { type: 'fault', active: true, reason: 'Test' });
const fault = await A.req('POST', '/api/calls', { requestId: 'r-3', floor: 1, passengerCount: 1 });
check('awaria: wezwanie z innego telefonu nadal jest aktywne, prognoza przerwana', (await A.req('GET', '/api/state')).data?.myCall?.eta === null);
check('awaria blokuje nowe wezwania', fault.status === 409 && fault.data.error === 'fault');
await admin.req('POST', '/api/admin/sim', { type: 'fault', active: false });

wsA2.ws.close();
wsAdmin.ws.close();
console.log(failures ? `\n${failures} niepowodzeń` : '\nWszystko OK');
process.exit(failures ? 1 : 0);
