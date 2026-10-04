/**
 * Icerik yedegi (T11.10 duzeltmesi): yedek metinler gateway'in icerik
 * dosyasindaki karsiliklariyla ayni kalmali; ayrilirlarsa icerik gelmeyince
 * bar baska, gelince baska yazardi.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTENT_FALLBACK, marketListContentSchema } from '../../src/index.js';

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
  marketList: unknown;
};

/** Yapidaki butun metinler (dizi ve ic nesneler dahil). */
function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(texts);
  return [];
}

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

  it('market listesi (T11.12) welcome.json marketList ile birebir: gruplar ve turler dahil', () => {
    expect(CONTENT_FALLBACK.marketList).toEqual(WELCOME.marketList);
  });

  it('yedegin market listesi sozlesmeden gecer (gorseller mutlak adrese cevrilince)', () => {
    const { marketList } = CONTENT_FALLBACK;
    const absolute = {
      ...marketList,
      groups: marketList.groups.map((group) => ({
        ...group,
        imageUrl: `https://cdn.example.com${group.imageUrl}`,
      })),
    };

    expect(marketListContentSchema.safeParse(absolute).success).toBe(true);
  });

  it('bos metin yok', () => {
    for (const text of texts(CONTENT_FALLBACK)) {
      expect(text.trim()).not.toBe('');
    }
  });
});
