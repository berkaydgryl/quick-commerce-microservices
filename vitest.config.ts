import { defineConfig } from 'vitest/config';

/**
 * Birim testleri: disa bagimlilik yok (Mongo/Redis/ag cagrisi kullanmaz).
 * Entegrasyon testleri ayri dosyadadir: vitest.integration.config.ts
 */

/** Birim testi tek basina saniyeler surmeli; asilirsa test yanlis katmandadir. */
const UNIT_TEST_TIMEOUT_MS = 10_000;
const UNIT_HOOK_TIMEOUT_MS = 10_000;

export default defineConfig({
  // Web'in derleme bayraklari (apps/web/vite.config.ts `define`): birim testleri
  // gelistirme paketini temsil eder. Production paketinde kapali olanlar paket
  // taramasiyla denetlenir (scripts/check-web-bundle.mjs).
  define: {
    __CARD_VAULT__: 'true',
  },
  test: {
    name: 'unit',
    environment: 'node',
    // scripts/test: kok betiklerin (git-conventions.mjs) testleri; betikler duz JS oldugu icin .mjs.
    include: ['{apps,packages}/**/test/unit/**/*.spec.ts', 'scripts/test/**/*.spec.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/gen/**'],
    testTimeout: UNIT_TEST_TIMEOUT_MS,
    hookTimeout: UNIT_HOOK_TIMEOUT_MS,
    clearMocks: true,
    restoreMocks: true,
    reporters: ['default'],
  },
});
