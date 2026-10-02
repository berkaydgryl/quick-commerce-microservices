/**
 * Kok betiklerin altyapi sozlesmesi (#51): `pnpm infra:up` konteynerler saglikli
 * olana kadar bekler. Yeni hacimde Mongo replica set'i saglik yoklamasi kurar;
 * beklenmezse hemen ardindan calisan seed "not primary" ile duser.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('pnpm infra:up', () => {
  it('saglik yoklamalarini bekler (--wait)', () => {
    expect(pkg.scripts['infra:up']).toMatch(/ up -d --wait$/);
  });
});
