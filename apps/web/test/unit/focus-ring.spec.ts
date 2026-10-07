/**
 * Odak halkasinin gorunurlugu (T11.10 duzeltmesi, QA B1). Ust bar halka rengini
 * beyaza ceker (mor zemin); icindeki beyaz yuzeyler rengi geri almazsa halka
 * beyaz zeminde gorunmez. Degisken kalitildigi icin kural CSS'te; testler
 * bu bildirimlerin yerinde kaldigini denetler (tarayicida canli olculur).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), 'utf8');

/** Bir sinifin ilk kural blogunun icerigi. */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} bulunamadi`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start));
}

describe('ust bar icindeki beyaz yuzeylerde odak halkasi', () => {
  it('bar halkayi beyaza ceker (mor zemin)', () => {
    expect(
      block(css('shared/ui/page-layout/PageLayout.module.css'), '.c-page-layout__header'),
    ).toContain('--focus-ring-color: var(--text-on-brand)');
  });

  it('karsilama bari da halkayi beyaza ceker (adres kurulumunda Profil orada, 07.10)', () => {
    expect(block(css('pages/welcome/WelcomeHeader.module.css'), '.c-welcome-header')).toContain(
      '--focus-ring-color: var(--text-on-brand)',
    );
  });

  it('arama kutusu: mor halka, kutunun icine cizilir', () => {
    const search = block(css('features/search/ui/HeaderSearch.module.css'), '.c-header-search');
    expect(search).toContain('--focus-ring-color: var(--color-brand-primary)');
    expect(search).toContain('--focus-ring-offset: calc(var(--focus-ring-width) * -1)');
  });

  it('adres pencereleri: mor halka, taban mesafe (kutunun "icine cizen" ayari kalitilmaz)', () => {
    const dialog = block(css('shared/ui/dialog/Dialog.module.css'), '.c-dialog');
    expect(dialog).toContain('--focus-ring-color: var(--color-brand-primary)');
    expect(dialog).toContain('--focus-ring-offset: var(--focus-ring-offset-base)');
  });

  it('Profil menusu: mor halka', () => {
    expect(
      block(css('features/auth/ui/HeaderAccount.module.css'), '.c-header-account__panel'),
    ).toContain('--focus-ring-color: var(--color-brand-primary)');
  });

  it('taban mesafe token olarak tanimli ve varsayilan mesafe ondan gelir', () => {
    const tokens = css('shared/styles/tokens.css');
    expect(tokens).toMatch(/--focus-ring-offset-base: [0-9.]+rem;/);
    expect(tokens).toContain('--focus-ring-offset: var(--focus-ring-offset-base);');
  });
});
