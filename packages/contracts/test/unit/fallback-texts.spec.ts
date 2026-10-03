/**
 * Icerik yedegi (T11.10 duzeltmesi): yedek metinler gateway'in icerik
 * dosyasindaki karsiliklariyla ayni kalmali; ayrilirlarsa icerik gelmeyince
 * bar baska, gelince baska yazardi.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTENT_FALLBACK } from '../../src/index.js';

const WELCOME = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../apps/gateway/internal/content/welcome.json', import.meta.url),
    ),
    'utf8',
  ),
) as {
  header: Record<string, string>;
  appHeader: Record<string, string>;
};

describe('CONTENT_FALLBACK', () => {
  it('logo ve giris metni welcome.json header ile ayni', () => {
    expect(CONTENT_FALLBACK.brand).toBe(WELCOME.header['brand']);
    expect(CONTENT_FALLBACK.service).toBe(WELCOME.header['service']);
    expect(CONTENT_FALLBACK.loginLabel).toBe(WELCOME.header['loginLabel']);
  });

  it('Profil menusu metinleri welcome.json appHeader ile ayni', () => {
    for (const key of [
      'profileLabel',
      'accountLabel',
      'logoutLabel',
      'logoutPendingLabel',
    ] as const) {
      expect(CONTENT_FALLBACK[key], key).toBe(WELCOME.appHeader[key]);
    }
  });

  it('bos metin yok', () => {
    for (const [key, value] of Object.entries(CONTENT_FALLBACK)) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});
