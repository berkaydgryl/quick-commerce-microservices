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
import { ProfileOverviewView } from '../../src/features/profile/ui/ProfileOverviewView';

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
      onEdit: () => undefined,
      onAddEmail: () => undefined,
      onVerifyPhone: () => undefined,
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
    expect(markup).toContain('aria-label="Profili düzenle"');
  });

  it('Hesabim sayfasinin kendisinde ad duz metin (kendine baglanti yok)', () => {
    const markup = card(PROFILE, true);

    expect(markup).toContain('Ayşe Yılmaz');
    expect(markup).not.toContain('href=');
  });

  it('telefon bosluklu yazilir (+90 532 123 45 67)', () => {
    expect(card(PROFILE)).toContain('+90 532 123 45 67');
  });

  it('dogrulanmamis numara: onay yerine "Doğrula" baglantisi (ADR-12, T11.14 PR 3)', () => {
    const phoneRow = card(PROFILE).slice(card(PROFILE).indexOf('aria-label="Telefon"'));

    expect(phoneRow).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Doğrula<\/button>/);
    expect(phoneRow).not.toContain('aria-label="Doğrulandı"');
  });

  it('SMS koduyla dogrulanmis numara: yesil onay, "Doğrula" yok', () => {
    const markup = card({ ...PROFILE, email: 'ayse@ornek.com', phoneVerified: true });
    const phoneRow = markup.slice(markup.indexOf('aria-label="Telefon"'));

    expect(markup.match(/aria-label="Doğrulandı"/g)).toHaveLength(2);
    expect(phoneRow).toContain('aria-label="Doğrulandı"');
    expect(phoneRow).not.toContain('>Doğrula<');
  });

  it('dogrulanmis e-posta: adres ve yesil onay; dogrulanmamis telefonda onay YOK', () => {
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
    expect(markup).toMatch(/<button[^>]*aria-label="Profili düzenle"[^>]*disabled=""/);
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

describe('ProfileOverviewView (Profili düzenle)', () => {
  const overview = (profile: UserProfile) =>
    renderToStaticMarkup(
      createElement(ProfileOverviewView, {
        profile,
        texts: TEXTS.editDialog,
        onEmail: () => undefined,
        onChangePhone: () => undefined,
        onVerifyPhone: () => undefined,
      }),
    );

  it('e-postasiz: "E-posta adresin yok" ve "Ekle"; dogrulanmamis telefon: "Doğrula" ve "Değiştir"', () => {
    const markup = overview(PROFILE);

    expect(markup).toContain('E-posta adresin yok');
    expect(markup).toMatch(/>Ekle<\/button>/);
    expect(markup).toContain('+90 532 123 45 67');
    expect(markup.indexOf('>Doğrula<')).toBeLessThan(markup.lastIndexOf('>Değiştir<'));
  });

  it('e-postali ve dogrulanmis telefonlu: iki "Değiştir", "Doğrula" yok', () => {
    const markup = overview({ ...PROFILE, email: 'ayse@ornek.com', phoneVerified: true });

    expect(markup).toContain('ayse@ornek.com');
    expect(markup.match(/>Değiştir<\/button>/g)).toHaveLength(2);
    expect(markup).not.toContain('>Doğrula<');
    expect(markup).not.toContain('>Ekle<');
  });
});
