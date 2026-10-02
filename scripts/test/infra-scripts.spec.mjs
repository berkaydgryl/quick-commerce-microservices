/**
 * Kok betiklerin sozlesmesi.
 *
 * - `pnpm infra:up` (#51) konteynerler saglikli olana kadar bekler. Yeni hacimde
 *   Mongo replica set'i saglik yoklamasi kurar; beklenmezse hemen ardindan calisan
 *   seed "not primary" ile duser.
 * - `pnpm race` (T11.1) yer tutucu degil: stok yarisi testini kosar.
 */

import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('pnpm infra:up', () => {
  it('saglik yoklamalarini bekler (--wait)', () => {
    expect(pkg.scripts['infra:up']).toMatch(/ up -d --wait$/);
  });
});

describe('pnpm race', () => {
  it('stok yarisi testini kosar; dosya yerinde (T11.1)', () => {
    const spec = 'apps/inventory-service/test/integration/race.spec.ts';

    expect(pkg.scripts.race).toBe(`vitest run --config vitest.integration.config.ts ${spec}`);
    expect(existsSync(new URL(`../../${spec}`, import.meta.url))).toBe(true);
  });
});
