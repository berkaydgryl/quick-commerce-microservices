import { defineConfig } from 'vitest/config';

/**
 * Birim testleri: disa bagimlilik yok (Mongo/Redis/ag cagrisi kullanmaz).
 * Entegrasyon testleri ayri dosyadadir: vitest.integration.config.ts
 */

/** Birim testi tek basina saniyeler surmeli; asilirsa test yanlis katmandadir. */
const UNIT_TEST_TIMEOUT_MS = 10_000;
const UNIT_HOOK_TIMEOUT_MS = 10_000;

export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['{apps,packages}/**/test/unit/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/gen/**'],
    testTimeout: UNIT_TEST_TIMEOUT_MS,
    hookTimeout: UNIT_HOOK_TIMEOUT_MS,
    clearMocks: true,
    restoreMocks: true,
    reporters: ['default'],
  },
});
