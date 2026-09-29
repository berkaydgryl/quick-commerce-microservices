// Gateway'in persona seed'ini (apps/gateway/cmd/seed-personas, Go) kokteki
// .env ile calistirir. `pnpm seed:personas` bunu order-service'in seed'inden
// SONRA cagirir: her servis kendi koleksiyonuna yazar (ADR-05), bu betik
// yalnizca Go komutuna ortami verir.
//
// NEDEN BETIK: Node servisleri .env'i `--env-file-if-exists` ile kendisi okur;
// Go'nun boyle bir bayragi yok ve gateway ortami yalnizca surecin ortamindan
// okur (config paketi). Kabukta `set -a; . ./.env` isletim sistemine gore
// degisir; process.loadEnvFile her yerde ayni calisir. Kabukta zaten tanimli
// degisken .env'deki degerden ONCE gelir (Node --env-file ile ayni kural).
//
// Kullanim (depo kokunden):  node scripts/seed-gateway-personas.mjs
// Go kurulu olmali (gateway'i calistiran her makinede var).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_FILE = `${ROOT}.env`;
const GATEWAY_DIR = `${ROOT}apps/gateway`;

if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

const result = spawnSync('go', ['run', './cmd/seed-personas'], {
  cwd: GATEWAY_DIR,
  stdio: 'inherit',
  env: process.env,
});

if (result.error !== undefined) {
  console.error(`go calistirilamadi: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
