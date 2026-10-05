/**
 * Kimlik alanlari (T11.16 duzeltmeleri, kullanici istegi):
 * - Goz dugmesi DURUMU gosterir: sifre gizliyken ustu cizili goz ve "Şifreyi
 *   göster", gorunurken acik goz ve "Şifreyi gizle"; aria-pressed yok.
 * - Telefon alaninda ipucu ("5XX ...") yok: bos alanda etiket ("Telefon
 *   Numarası") kutunun icinde, deger girilince uste kayar (CSS
 *   :placeholder-shown); etiket her durumda gercek <label>.
 * Metinler icerik yedeginden.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CONTENT_FALLBACK } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PasswordField, PasswordToggle } from '../../src/features/auth/ui/PasswordField';
import { PhoneField } from '../../src/features/auth/ui/PhoneField';

const TEXTS = CONTENT_FALLBACK.profile.phoneDialog;
const LABELS = { showLabel: TEXTS.showPasswordLabel, hideLabel: TEXTS.hidePasswordLabel };
const noop = () => undefined;

/** Ustu cizili gozun capraz cizgisi ve acik gozun bebegi (icons.tsx). */
const SLASH = 'd="M3 3l18 18"';
const PUPIL = '<circle';

const toggle = (visible: boolean) =>
  renderToStaticMarkup(
    createElement(PasswordToggle, { ...LABELS, visible, controls: 'sifre', onToggle: noop }),
  );

const phone = (value: string, prefix?: string) =>
  renderToStaticMarkup(
    createElement(PhoneField, {
      id: 'telefon',
      label: 'Telefon Numarası',
      value,
      onChange: noop,
      ...(prefix === undefined ? {} : { prefix }),
    }),
  );

describe('goz dugmesi (T11.16)', () => {
  it('sifre gizliyken: ustu cizili goz, "Şifreyi göster"', () => {
    const html = toggle(false);

    expect(html).toContain(SLASH);
    expect(html).not.toContain(PUPIL);
    expect(html).toContain('aria-label="Şifreyi göster"');
  });

  it('sifre gorunurken: acik goz, "Şifreyi gizle"', () => {
    const html = toggle(true);

    expect(html).toContain(PUPIL);
    expect(html).not.toContain(SLASH);
    expect(html).toContain('aria-label="Şifreyi gizle"');
  });

  it('iki durumda da aria-pressed yok (ad durumla degisir; durum ikinci kez verilmez)', () => {
    expect(toggle(false)).not.toContain('aria-pressed');
    expect(toggle(true)).not.toContain('aria-pressed');
  });

  it('sifre alani gizli acilir: type=password, dugme alani denetler', () => {
    const html = renderToStaticMarkup(
      createElement(PasswordField, { id: 'sifre', label: TEXTS.passwordLabel, ...LABELS }),
    );

    expect(html).toMatch(/<input[^>]*type="password"/);
    expect(html).toContain('aria-controls="sifre"');
    expect(html).toContain('aria-label="Şifreyi göster"');
    expect(html).toContain(SLASH);
  });
});

describe('telefon alani (T11.16)', () => {
  it('bos: ipucu metni yok, yuzen etiket gercek <label>', () => {
    const html = phone('');

    expect(html).toMatch(/<input[^>]*placeholder=" "/);
    expect(html).toMatch(/<input[^>]*value=""/);
    expect(html).not.toContain('5XX');
    expect(html).toContain('c-auth-field--floating');
    expect(html).toMatch(/<label for="telefon"[^>]*>Telefon Numarası<\/label>/);
  });

  it('dolu: deger bicimli, etiket ayni <label> (uste kayma CSS ile)', () => {
    const html = phone('5550000001');

    expect(html).toMatch(/<input[^>]*value="555 000 00 01"/);
    expect(html).toContain('c-auth-field--floating');
    expect(html).toMatch(/<label for="telefon"[^>]*>Telefon Numarası<\/label>/);
  });

  it('profildeki numara degistirme: sabit "+90" oneki, ayni yuzen etiket', () => {
    const html = phone('', '+90');

    expect(html).toContain('>+90<');
    expect(html).toContain('c-auth-field--floating');
  });

  it('CSS: bos alanda etiket ortada ve deger boyunda; hareket azaltmada gecis yok', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../../src/features/auth/ui/AuthField.module.css', import.meta.url)),
      'utf8',
    );
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
    };

    const empty = rule(
      '.c-auth-field--floating .c-auth-field__input:placeholder-shown + .c-auth-field__label',
    );
    expect(empty).toContain('inset-block-start: 50%');
    expect(empty).toContain('font-size: var(--font-size-md)');
    expect(empty).toContain('transform: translateY(-50%)');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.c-auth-field--floating \.c-auth-field__label \{\s*transition: none;/,
    );
  });
});
