/**
 * 3DS penceresi (T12.4; T17.1 geri sayim): aciklama, kalan sure (son 30
 * saniyede uyari sinifi; ekran okuyucu notu yalnizca uyari durumunda), kod
 * alani (rakam klavyesi, tek seferlik kod, 6 hane), yanlis kodun cumlesi ve
 * kalan hak, "Vazgeç" (sag ustteki X ile ayni ad). Kod alani bos baslar.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ThreeDsDialog } from '../../src/features/checkout/ui/ThreeDsDialog';

const TEXTS = CONTENT_FALLBACK.checkout;

function dialog(
  remaining: number | undefined,
  failure?: { message: string; attemptsLeft: number },
  verifying = false,
) {
  return renderToStaticMarkup(
    createElement(ThreeDsDialog, {
      texts: TEXTS,
      remaining,
      verifying,
      failure,
      onSubmit: () => undefined,
      onCancel: () => undefined,
    }),
  );
}

describe('ThreeDsDialog (T12.4, T17.1)', () => {
  it('baslik, aciklama, kalan sure "1:00"; uyari yok, ekran okuyucu notu bos', () => {
    const markup = dialog(60);

    expect(markup).toContain('>3D Secure Doğrulama</h2>');
    expect(markup).toContain(TEXTS.threeDsDescription);
    expect(markup).toMatch(/role="timer" class="[^"]*c-three-ds__time[^"]*">1:00</);
    expect(markup).not.toContain('is-warning');
    expect(markup).toMatch(/aria-live="polite"><\/p>/);
  });

  it('K1: sunucu sure bildirmediyse sayac YOK (istemci sure tahmin etmez); kod alani yine var', () => {
    const html = dialog(undefined);

    expect(html).not.toContain('role="timer"');
    expect(html).not.toContain(TEXTS.threeDsRemainingLabel);
    expect(html).toContain('autoComplete="one-time-code"');
  });

  it('son 30 saniye: uyari sinifi ve "Son 30 saniye" (aria-live)', () => {
    const markup = dialog(30);

    expect(markup).toMatch(/role="timer" class="[^"]*is-warning[^"]*">0:30</);
    expect(markup).toMatch(/aria-live="polite">Son 30 saniye<\/p>/);
  });

  it('kod alani: rakam klavyesi, tek seferlik kod, 6 hane, bos; "Onayla" pasif', () => {
    const markup = dialog(45);

    expect(markup).toMatch(
      /inputMode="numeric"[^>]*autoComplete="one-time-code"[^>]*maxLength="6"/,
    );
    expect(markup).toMatch(/<input[^>]*value=""/);
    expect(markup).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Onayla<\/button>/);
  });

  it('yanlis kod: alan gecersiz, sunucunun cumlesi ve kalan hak', () => {
    const markup = dialog(45, {
      message: 'Doğrulama kodu geçersiz. Tekrar dener misin?',
      attemptsLeft: 2,
    });

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('Doğrulama kodu geçersiz. Tekrar dener misin? 2 deneme hakkın kaldı');
  });

  it('dogrulanirken "Doğrulanıyor…"; "Vazgeç" hem dugme hem pencerenin kapat adi', () => {
    const markup = dialog(45, undefined, true);

    expect(markup).toContain('>Doğrulanıyor…</button>');
    expect(markup).toContain('>Vazgeç</button>');
    expect(markup).toContain('aria-label="Vazgeç"');
  });
});
