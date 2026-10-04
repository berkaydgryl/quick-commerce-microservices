/**
 * Profil karti ve e-posta penceresinin zaman gorunumu (T11.14; PR 2'de
 * referansa gore: getircarsi profil sayfasi, ad -> e-posta -> telefon).
 * Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { UserProfile } from '@getir/contracts';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CodeTimerView } from '../../src/features/profile/ui/CodeTimerView';
import { ProfileCardView } from '../../src/features/profile/ui/ProfileCardView';

const TEXTS = CONTENT_FALLBACK.profile;
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

const PROFILE: UserProfile = {
  id: 'usr_0123456789abcdef0123456789abcdef',
  phone: '+905321234567',
  fullName: 'Ayşe Yılmaz',
};

/** Alt sekmedeki kart (ad Hesabim'a gider); onAccountPage: Hesabim'in kendisi. */
const card = (profile: UserProfile | undefined, onAccountPage = false) =>
  render(
    createElement(ProfileCardView, {
      profile,
      texts: TEXTS,
      accountHref: onAccountPage ? undefined : '/hesabim',
      onEditEmail: () => undefined,
    }),
  );

describe('ProfileCardView', () => {
  it("sira (referans): ad, e-posta, telefon; alt sekmede ad Hesabim'a gider", () => {
    const markup = card({ ...PROFILE, email: 'ayse@ornek.com' });

    const order = ['Ayşe Yılmaz', 'aria-label="E-posta"', 'aria-label="Telefon"'].map((text) =>
      markup.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toMatch(/<a[^>]*href="\/hesabim"[^>]*>Ayşe Yılmaz<\/a>/);
    expect(markup).toContain('aria-label="E-posta adresini düzenle"');
  });

  it('Hesabim sayfasinin kendisinde ad duz metin (kendine baglanti yok)', () => {
    const markup = card(PROFILE, true);

    expect(markup).toContain('Ayşe Yılmaz');
    expect(markup).not.toContain('href=');
  });

  it('telefon bosluklu yazilir (+90 532 123 45 67)', () => {
    expect(card(PROFILE)).toContain('+90 532 123 45 67');
  });

  it('dogrulanmis e-posta: adres ve yesil onay; telefonda onay YOK (ADR-12)', () => {
    const markup = card({ ...PROFILE, email: 'ayse@ornek.com' });

    expect(markup).toContain('ayse@ornek.com');
    expect(markup.match(/aria-label="Doğrulandı"/g)).toHaveLength(1);
    const phoneRow = markup.slice(markup.indexOf('aria-label="Telefon"'));
    expect(phoneRow).not.toContain('Doğrulandı');
    expect(markup).not.toContain('E-posta ekle');
  });

  it('e-postasiz kart: e-posta satirinda "E-posta ekle", onay yok', () => {
    const markup = card(PROFILE);

    expect(markup).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>E-posta ekle<\/button>/);
    expect(markup).not.toContain('Doğrulandı');
  });

  it('yuklenirken: durum metni, kalem basilamaz', () => {
    const markup = card(undefined);

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Bilgilerin yükleniyor…');
    expect(markup).toMatch(/<button[^>]*aria-label="E-posta adresini düzenle"[^>]*disabled=""/);
  });
});

describe('CodeTimerView', () => {
  // Yonlendirici gerekmez: zaman gorunumunde baglanti yok.
  const timer = (expiresIn: number, resendIn: number, resending = false) =>
    renderToStaticMarkup(
      createElement(CodeTimerView, {
        texts: TEXTS.emailDialog,
        expiresIn,
        resendIn,
        resending,
        onResend: () => undefined,
      }),
    );

  it('gecerlilik geri sayimi; bekleme bitmeden yeniden gonderme kapali ve kalan sure yazili', () => {
    const markup = timer(581, 42);

    expect(markup).toContain('Kodun geçerlilik süresi');
    expect(markup).toContain('9:41');
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>Yeni kodu isteyebilmen için 0:42<\/button>/,
    );
    // Geri sayim her saniye duyurulmaz.
    expect(markup).not.toContain('role="status"');
  });

  it('bekleme bitince "Kodu yeniden gönder" basilabilir', () => {
    const markup = timer(300, 0);

    expect(markup).toMatch(/<button type="button"[^>]*>Kodu yeniden gönder<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Kodu yeniden gönder/);
  });

  it('sure dolunca uyari duyurulur (role=status)', () => {
    const markup = timer(0, 0);

    expect(markup).toMatch(/role="status"[^>]*>Kodun süresi doldu. Yeni kod isteyebilirsin.</);
    expect(markup).not.toContain('Kodun geçerlilik süresi');
  });

  it('yeni kod istegi surerken dugme kapali', () => {
    expect(timer(300, 0, true)).toMatch(/<button[^>]*disabled=""[^>]*>Kodu yeniden gönder/);
  });
});
