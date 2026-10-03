// Prawdziwy przebieg w przeglądarce (Edge/Chrome headless przez CDP), ekran 390×844:
// aktywacja kodem QR → wezwanie → przycisk na 2. piętrze z panelu → przyjazd.
// Użycie: `npm run dev`, potem `node scripts/ui-flow.mjs [katalog-na-zrzuty]`.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? 'screenshots/flow';
const PORT = 9333;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? readFileSync('.dev.vars', 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ── administrator przez API: kod aktywacyjny i panel symulatora ──
const adminJar = {};
async function admin(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { origin: BASE, 'content-type': 'application/json', cookie: Object.entries(adminJar).map(([k, v]) => `${k}=${v}`).join('; ') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    adminJar[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return res.json();
}
await admin('POST', '/api/admin/login', { password: ADMIN_PASSWORD });
await admin('POST', '/api/admin/reset');
// Przewidywalny scenariusz: bez ruchu tła na czas testu (przywracany na końcu).
await admin('POST', '/api/admin/sim', { type: 'config', patch: { ambientTraffic: false } });
const { url: activationUrl } = await admin('POST', '/api/admin/codes', { ttlHours: 1 });

// ── przeglądarka ──
const exe = BROWSERS.find((b) => existsSync(b));
if (!exe) throw new Error('Nie znaleziono Edge ani Chrome (ustaw BROWSER=ścieżka).');
const profile = join(process.env.CLAUDE_JOB_DIR ?? '.', 'tmp', `cdp-profile-${Date.now()}`);
const proc = spawn(exe, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expr)) return true;
    await sleep(150);
  }
  return false;
};
const text = () => evaluate('document.body.innerText');
const click = (label) =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => x.innerText.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())} || x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
const shot = async (name) => {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log(`zrzut: ${name}.png`);
};

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 1. Aktywacja
await cdp('Page.navigate', { url: activationUrl });
check('ekran aktywacji z nazwą budynku', await waitFor(`document.body.innerText.toUpperCase().includes('BUDYNEK DEMONSTRACYJNY')`));
await shot('01-aktywacja');
await click('Aktywuj dostęp');
check('po aktywacji: „Telefon został dodany”', await waitFor(`document.body.innerText.toUpperCase().includes('TELEFON ZOSTAŁ DODANY')`));
await click('4. piętro');
await evaluate(`(() => { const i = document.querySelector('input[type=text]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Telefon testowy'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await shot('01b-telefon-dodany');
await click('Przejdź do aplikacji');
check('po aktywacji ekran główny', await waitFor(`document.body.innerText.includes('WEZWIJ WINDĘ') || document.body.innerText.includes('Wezwij windę')`));
await sleep(500);
await shot('02-ekran-glowny');

// 2. Wezwanie z 4. piętra dla 2 osób
await click('4. piętro');
await evaluate(`(() => { const r = document.querySelector('input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '2'); r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await click('Wezwij windę');
check('po akceptacji serwera: „Winda jedzie do Ciebie”', await waitFor(`document.body.innerText.toUpperCase().includes('WINDA JEDZIE DO CIEBIE')`));
check('czytnik ekranu: „Wezwanie przyjęte”', (await evaluate(`[...document.querySelectorAll('[aria-live]')].map((x) => x.innerText).join(' ')`))?.includes('Wezwanie przyjęte'));
await shot('03-winda-jedzie');

// 3. Na 7. piętrze 5 osób wzywa windę (jadą na parter): kabina jedzie najpierw tam.
await admin('POST', '/api/admin/sim', { type: 'hall_press', floor: 7, dests: [0, 0, 0, 0, 0] });
check('ETA przeliczone: „Dodano postój na 7. piętrze”', await waitFor(`document.body.innerText.includes('Dodano postój na 7. piętrze')`));
await shot('04-dodano-postoj');

// 4. Po postoju na 7. zostaje 1 miejsce → oczekiwanie na kolejny przejazd
check('„Oczekiwanie na miejsce”', await waitFor(`document.body.innerText.toUpperCase().includes('OCZEKIWANIE NA MIEJSCE')`, 45000));
await shot('05-oczekiwanie');

// 5. Kabina wraca: przyjazd
check('„Winda przyjechała na Twoje piętro”', await waitFor(`document.body.innerText.toUpperCase().includes('WINDA PRZYJECHAŁA')`, 100000));
await shot('06-przyjazd');

// 6. Awaria z panelu
await sleep(4000);
await admin('POST', '/api/admin/sim', { type: 'fault', active: true, reason: 'Test' });
check('„Winda niedostępna”', await waitFor(`document.body.innerText.toUpperCase().includes('WINDA NIEDOSTĘPNA')`));
await shot('07-awaria');
await admin('POST', '/api/admin/sim', { type: 'fault', active: false });

// 7. Brak sieci
await cdp('Network.enable');
await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await evaluate(`window.dispatchEvent(new Event('offline'))`);
console.log('(brak sieci: czekamy na wykrycie zerwanego połączenia)');
const offline = await waitFor(`document.body.innerText.toUpperCase().includes('BRAK POŁĄCZENIA')`, 15000);
check('„Brak połączenia”, odliczanie wstrzymane', offline);
if (offline) await shot('08-brak-polaczenia');
await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await evaluate(`window.dispatchEvent(new Event('online'))`);
check('po powrocie sieci: aktualny stan', await waitFor(`document.body.innerText.includes('Połączono')`, 20000));

// 8. Ustawienia: domyślne piętro i nazwa zapisane przy aktywacji
await click('Ustawienia');
const settingsOk = await waitFor(`document.body.innerText.includes('Telefon testowy') && document.body.innerText.includes('4. piętro')`);
check('ustawienia: domyślne piętro i nazwa z aktywacji', settingsOk);
await shot('09-ustawienia');

// 9. Ten sam kod drugi raz: „Kod został już wykorzystany”
await cdp('Page.navigate', { url: activationUrl });
check('kod wykorzystany: konkretny komunikat', await waitFor(`document.body.innerText.toUpperCase().includes('KOD ZOSTAŁ JUŻ WYKORZYSTANY')`));
await shot('10-kod-wykorzystany');

await admin('POST', '/api/admin/sim', { type: 'config', patch: { ambientTraffic: true } });
ws.close();
proc.kill();
console.log(failures ? `\n${failures} niepowodzeń` : '\nWszystko OK');
process.exit(failures ? 1 : 0);
