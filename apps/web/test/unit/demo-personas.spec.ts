/**
 * Web'deki persona kopyasi gateway'in persona dosyasiyla ayni mi (T8.5)?
 * Biri degisip digeri unutulursa secici olmayan bir hesabi doldurur ve giris
 * INVALID_CREDENTIALS ile duser; bu test farki derlemede yakalar.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DEMO_PASSWORD, DEMO_PERSONAS } from '../../src/features/auth/demo/personas';

const PERSONAS_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../gateway/internal/persona/personas.json',
);

const personasFileSchema = z.object({
  password: z.string(),
  accounts: z.array(
    z.object({
      persona: z.string(),
      band: z.string().optional(),
      phone: z.string(),
      fullName: z.string(),
      selectable: z.boolean().optional(),
    }),
  ),
});

const gateway = personasFileSchema.parse(JSON.parse(readFileSync(PERSONAS_JSON, 'utf8')));

describe('demo personalari gateway ile ayni (T8.5)', () => {
  it('demo sifresi ayni', () => {
    expect(DEMO_PASSWORD).toBe(gateway.password);
  });

  it('secilebilir hesaplar ayni sirayla, ayni telefon, ad ve bantla', () => {
    const selectable = gateway.accounts
      .filter((account) => account.selectable === true)
      .map(({ persona, band, phone, fullName }) => ({ persona, band, phone, fullName }));

    expect(DEMO_PERSONAS).toEqual(selectable);
  });
});
