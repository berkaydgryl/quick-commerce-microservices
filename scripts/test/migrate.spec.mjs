/**
 * Kok goc komutunun plani (T10.4): hangi komut kokten calisir, hangisi reddedilir.
 * Komutlar calistirilmaz; yalnizca adimlar denetlenir.
 */

import { describe, expect, it } from 'vitest';

import { migratePlan } from '../migrate.mjs';

describe('migratePlan', () => {
  it.each(['up', 'status'])(
    '%s: once servisler derlenir, sonra her serviste sirayla calisir',
    (command) => {
      const plan = migratePlan([command]);

      expect(plan).toEqual({
        steps: [
          ['pnpm', 'exec', 'turbo', 'run', 'build', '--filter=./apps/*-service'],
          [
            'pnpm',
            '-r',
            '--filter',
            './apps/*',
            '--if-present',
            '--workspace-concurrency=1',
            'run',
            'migrate',
            command,
          ],
        ],
      });
    },
  );

  it('down kokten reddedilir: butun servislerde son gocu geri alirdi; servis bazinda yolu soyler', () => {
    const plan = migratePlan(['down']);

    expect(plan).toHaveProperty('error');
    expect(plan.error).toContain('pnpm --filter @getir/<servis> migrate down');
  });

  it.each([[[]], [['yukari']], [['up', 'fazla']]])(
    'gecersiz kullanim %j: hata, adim yok',
    (args) => {
      expect(migratePlan(args)).toEqual({ error: 'kullanim: pnpm migrate up | status' });
    },
  );
});
