import { defineConfig } from 'vitest/config';

/**
 * Entegrasyon testleri: gercek Mongo ve Redis bekler (docker compose ile ayaga kalkar).
 * Mongo baglantisi tek dugumlu replica set oldugu icin directConnection=true kullanilir.
 */

/** Konteynerlerin hazir olmasi ve ilk baglanti icin genis pay birakilir. */
const INTEGRATION_TEST_TIMEOUT_MS = 60_000;
const INTEGRATION_HOOK_TIMEOUT_MS = 60_000;

export default defineConfig({
  test: {
    name: 'integration',
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
