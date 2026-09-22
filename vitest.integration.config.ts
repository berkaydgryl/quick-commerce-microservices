import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Entegrasyon testleri: gercek Mongo ve Redis bekler (docker compose ile ayaga kalkar).
 * Mongo baglantisi tek dugumlu replica set oldugu icin directConnection=true kullanilir.
 */

/** Konteynerlerin hazir olmasi ve ilk baglanti icin genis pay birakilir. */
const INTEGRATION_TEST_TIMEOUT_MS = 60_000;
const INTEGRATION_HOOK_TIMEOUT_MS = 60_000;

/**
 * Testcontainers'in Docker'i bulmasi.
 *
 * CI (ubuntu runner) ve Docker Desktop'ta /var/run/docker.sock hazirdir, burasi
 * hicbir sey yapmaz. macOS + colima kurulumunda ise soket kullanicinin ev
 * dizinindedir ve testcontainers onu kendiliginden bulamaz; ustelik reaper
 * (Ryuk) konteyneri soketi kendi icine baglarken KONTEYNER ICINDEKI yolu ister.
 * Bu yuzden iki degisken birden verilir. Elle "export DOCKER_HOST=..." yazmak
 * zorunda kalmamak icin burada, tek yerde cozuluyor.
 */
function dockerEnv(): Record<string, string> {
  if (process.env.DOCKER_HOST !== undefined || existsSync('/var/run/docker.sock')) {
    return {};
  }

  const colimaSocket = join(homedir(), '.colima', 'default', 'docker.sock');
  if (!existsSync(colimaSocket)) {
    return {};
  }

  return {
    DOCKER_HOST: `unix://${colimaSocket}`,
    TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: '/var/run/docker.sock',
  };
}

export default defineConfig({
  test: {
    name: 'integration',
    env: dockerEnv(),
    environment: 'node',
    include: ['{apps,packages}/**/test/integration/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/gen/**'],
    testTimeout: INTEGRATION_TEST_TIMEOUT_MS,
    hookTimeout: INTEGRATION_HOOK_TIMEOUT_MS,
    // Paylasilan Mongo/Redis durumunu bozmamak icin dosyalar sirayla kosar.
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
    reporters: ['default'],
  },
});
