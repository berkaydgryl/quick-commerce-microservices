/**
 * Kart Ekle formu (T11.17; referans getircarsi "Kart Ekle"; F14): sirayla
 * en ustte kart gorseli (Guvenlik kutusu yok), kart adi, numara, kart uzerindeki
 * isim, son kullanma (Ay/Yil secimleri) ve CVV, zorunlu kosul onayi, Devam,
 * sayfada Devam'in altinda kucuk guvenlik satiri ve kabul edilen kartlar. Uyarinin geri sayimi canli bolgenin disinda (QA C2);
 * kosullar penceresi icerikten. Metinler icerik yedeginden.
 */

import { CARD_EXPIRY_MAX_YEARS_AHEAD, CONTENT_FALLBACK } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcceptedBrands } from '../../src/features/cards/ui/AcceptedBrands';
import { AddCardForm } from '../../src/features/cards/ui/AddCardForm';
import { FormAlert } from '../../src/features/cards/ui/FormAlert';
import { TermsDialog } from '../../src/features/cards/ui/TermsDialog';

import { VISA_CARD } from './card-test-support';

const TEXTS = CONTENT_FALLBACK.paymentMethods;
const noop = () => undefined;
const escape = (text: string) => text.replace(/'/g, '&#x27;');

/** Tur verilmezse AddCardPage'deki gibi varsayilan ("page"). */
const form = (variant?: 'page' | 'checkout') =>
  renderToStaticMarkup(
    createElement(AddCardForm, {
      texts: TEXTS,
      ...(variant === undefined ? {} : { variant }),
      onSave: () => Promise.resolve(VISA_CARD),
      onChanged: noop,
      onSaved: noop,
    }),
  );

/** Metindeki parcalarin sirasi: her biri bir oncekinden sonra gelir. */
const inOrder = (html: string, needles: readonly string[]) =>
  needles
    .map((needle) => html.indexOf(needle))
    .every((at, index, all) => at > (all[index - 1] ?? -1));

describe('AddCardForm (T11.17, referans getircarsi)', () => {
  it('sira: en ustte kart, alanlar, son kullanma, CVV, onay, Devam, guvenlik satiri, markalar', () => {
    const html = form();

    expect(
      inOrder(html, [
        'c-payment-card__tilt',
        'id="kart-takma-ad"',
        'id="kart-numara"',
        'id="kart-ad"',
        TEXTS.expiryLegend,
        'id="kart-cvv"',
        'type="checkbox"',
        `>${TEXTS.saveLabel}</button>`,
        escape(TEXTS.securityText),
        `aria-label="${TEXTS.acceptedBrandsLabel}"`,
      ]),
    ).toBe(true);
  });

  it('F14: iki turde de kart formun ilk ogesi; Guvenlik kutusu (baslik, ikon) yok', () => {
    for (const variant of [undefined, 'page', 'checkout'] as const) {
      const html = form(variant);
      const formOpen = html.indexOf('<form');

      // Formun ILK ogesi kart sahnesi (araya hicbir oge girmez).
      expect(html.slice(formOpen)).toMatch(/^<form[^>]*><div class="[^"]*c-add-card__stage/);
      expect(html).not.toContain('c-security-notice');
      expect(html).not.toContain('>Güvenlik<');
    }
  });

  it("F14: guvenlik cumlesi sayfada (varsayilan) Devam'in altinda; Devam ona bagli; pencerede YOK", () => {
    const page = form();
    const securityId = /<p id="([^"]+)" class="[^"]*c-add-card__security/.exec(page)?.[1];

    expect(securityId).toBeDefined();
    expect(page).toContain(
      `aria-describedby="${securityId}">${TEXTS.saveLabel}</button><p id="${securityId}"`,
    );
    expect(form('checkout')).not.toContain(escape(TEXTS.securityText));
    expect(page.toLowerCase()).not.toContain('masterpass');
  });

  it('dort metin alani yuzen etiketle, kart otomatik doldurma adlariyla', () => {
    const html = form();

    for (const [id, label, autocomplete] of [
      ['kart-takma-ad', TEXTS.nicknameLabel, 'off'],
      ['kart-numara', TEXTS.numberLabel, 'cc-number'],
      ['kart-ad', TEXTS.holderNameLabel, 'cc-name'],
      ['kart-cvv', TEXTS.cvvLabel, 'cc-csc'],
    ] as const) {
      expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*autoComplete="${autocomplete}"`));
      expect(html).toContain(`<label for="${id}"`);
      expect(html).toContain(`>${escape(label)}</label>`);
    }
    expect(html).toContain('c-auth-field--floating');
    expect(html).not.toContain(TEXTS.numberValidLabel);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('son kullanma: Ay 01-12, Yil bu yil + 20 (sozlesmeden); ilk secenek yer tutucu', () => {
    // Sabit saat (QA K7: deterministik test); 5 Ekim 2026 Istanbul.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
    const html = form();

    // QA K3: gorunen baslik iki sutunun ustunde kendi satirinda; grup adi ondan.
    expect(html).toMatch(/<p id="kart-skt-baslik"[^>]*>Kartın Son Kullanma Tarihi:<\/p>/);
    expect(html).toMatch(/<fieldset[^>]*aria-labelledby="kart-skt-baslik"/);
    expect(html).not.toContain('<legend');
    expect(html).toContain(`<option value="" disabled="" selected="">${TEXTS.monthLabel}</option>`);
    expect(html).toContain(`<option value="" disabled="" selected="">${TEXTS.yearLabel}</option>`);
    expect(html.match(/<option value="(0[1-9]|1[0-2])"/g)).toHaveLength(12);
    expect(html).toContain('<option value="2026"');
    expect(html).toContain(`<option value="${2026 + CARD_EXPIRY_MAX_YEARS_AHEAD}"`);
    expect(html).not.toContain(`<option value="${2026 + CARD_EXPIRY_MAX_YEARS_AHEAD + 1}"`);
    expect(html).not.toContain('<option value="2025"');
    expect(html).toContain('is-empty');
  });

  it('QA D3: yilbasi gecesi UTC 22:30 (Istanbul 01:30) yillar Istanbul takviminden', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-31T22:30:00.000Z'));

    const years = [...form().matchAll(/<option value="(\d{4})"/g)].map((match) => match[1]);

    expect(years[0]).toBe('2027');
    expect(years.at(-1)).toBe(String(2027 + CARD_EXPIRY_MAX_YEARS_AHEAD));
  });

  it('zorunlu onay: isaretsiz kutu; "Kullanım Koşulları" pencereyi acan dugme', () => {
    const html = form();

    expect(html).toMatch(/<input[^>]*id="kart-kosullar"[^>]*type="checkbox"/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toContain(`<button type="button" class=`);
    expect(html).toMatch(new RegExp(`<button type="button"[^>]*>${TEXTS.termsLinkLabel}</button>`));
    expect(html).toContain(`<label for="kart-kosullar">${escape(TEXTS.termsSuffix)}</label>`);
    // QA D1, K5: kutunun adi tek parca cumle ("Kullanım Koşulları'nı okudum, kabul ediyorum.").
    const box = /<input[^>]*id="kart-kosullar"[^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain(`aria-label="${escape(TEXTS.termsLinkLabel + TEXTS.termsSuffix)}"`);
    expect(box).not.toContain('aria-labelledby');
    expect(html).not.toContain('<dialog');
  });

  it('ilk halde uyari yok; Devam acik, kart varsayilan renkte yer tutucularla', () => {
    const html = form();

    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(new RegExp(`<button type="submit"[^>]*>${TEXTS.saveLabel}</button>`));
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).toContain(TEXTS.holderPlaceholder);
    expect(html).toContain(TEXTS.nicknamePlaceholder);
    expect(html).toContain(TEXTS.expiryPlaceholder);
  });
});

describe('FormAlert (T11.17, QA C2)', () => {
  const alert = (waitSeconds: number) =>
    renderToStaticMarkup(
      createElement(FormAlert, {
        message: 'Çok fazla deneme yaptın.',
        waitLabel: TEXTS.retryWaitLabel,
        waitSeconds,
      }),
    );

  it('cumle canli bolgede; geri sayim bolgenin DISINDA', () => {
    const html = alert(299);
    const region = /<p role="alert">(.*?)<\/p>/.exec(html)?.[1];

    expect(region).toBe('Çok fazla deneme yaptın.');
    expect(html).toContain('<time>4:59</time>');
    expect(region).not.toContain('<time>');
  });

  it('bekleme yoksa geri sayim yok', () => {
    expect(alert(0)).not.toContain('<time>');
  });
});

describe('TermsDialog ve AcceptedBrands (T11.17)', () => {
  it('kosullar penceresi: baslik ve paragraflar icerikten, X ile kapanir', () => {
    const html = renderToStaticMarkup(
      createElement(TermsDialog, {
        title: TEXTS.termsTitle,
        paragraphs: TEXTS.termsParagraphs,
        closeLabel: TEXTS.closeLabel,
        onClose: noop,
      }),
    );

    expect(html).toContain('<dialog');
    expect(html).toContain(`>${TEXTS.termsTitle}</h2>`);
    expect(html).toContain(`aria-label="${TEXTS.closeLabel}"`);
    for (const paragraph of TEXTS.termsParagraphs) {
      expect(html).toContain(`<p>${escape(paragraph)}</p>`);
    }
  });

  it('kabul edilen kartlar: Amex, Mastercard, Visa, Troy; yazilan marka disindakiler soluk', () => {
    const html = renderToStaticMarkup(
      createElement(AcceptedBrands, {
        label: TEXTS.acceptedBrandsLabel,
        labels: TEXTS.brandLabels,
        marks: TEXTS.brandMarks,
        active: 'VISA',
      }),
    );
    const items = html.split('<li').slice(1);

    expect(items.map((item) => /__name[^>]*>([^<]+)</.exec(item)?.[1])).toEqual([
      TEXTS.brandLabels.AMEX,
      TEXTS.brandLabels.MASTERCARD,
      TEXTS.brandLabels.VISA,
      TEXTS.brandLabels.TROY,
    ]);
    expect(items.map((item) => item.includes('is-dimmed'))).toEqual([true, true, false, true]);
    expect(html).toContain('<svg');
  });
});
