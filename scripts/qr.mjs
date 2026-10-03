// Jeden kod QR dla wszystkich telefonów.
// Użycie: `npm run qr -- https://winda.<konto>.workers.dev` → docs/qr/qr-demo.svg i .png.
// Domyślnie publiczne wejście demo (`demo.wersja-demonstracyjna`, nie wymaga sekretu).
// `--token`: zamiast tego kod z DEMO_ACTIVATION_CODE (środowisko albo .dev.vars).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const useToken = process.argv.includes('--token');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let code = 'demo.wersja-demonstracyjna';
if (useToken || process.argv.includes('--print-token')) {
  const token =
    process.env.DEMO_ACTIVATION_CODE ??
    readFileSync('.dev.vars', 'utf8').match(/^DEMO_ACTIVATION_CODE=(.*)$/m)?.[1]?.trim();
  if (!token || token.length < 20) {
    console.error('Brak DEMO_ACTIVATION_CODE (min. 20 znaków) w środowisku ani w .dev.vars.');
    process.exit(1);
  }
  if (process.argv.includes('--print-token')) {
    process.stdout.write(token);
    process.exit(0);
  }
  code = `demo.${token}`;
}

const base = (args[0] ?? 'http://localhost:5173').replace(/[./]+$/, '');
const url = `${base}/aktywacja#${code}`;
mkdirSync('docs/qr', { recursive: true });
const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#15171A', light: '#FFFFFF' } };
writeFileSync('docs/qr/qr-demo.svg', await QRCode.toString(url, { ...opts, type: 'svg' }));
await QRCode.toFile('docs/qr/qr-demo.png', url, { ...opts, width: 1024 });
console.log(`Kod QR: docs/qr/qr-demo.svg, docs/qr/qr-demo.png
Odnośnik: ${url}`);
