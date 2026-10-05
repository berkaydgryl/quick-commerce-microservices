/**
 * Adres silme onayi (T11.15, T5): soru adin arkasina eklenir, siparislerin
 * etkilenmedigi notu, "Vazgeç" ve "Sil"; silme surerken dugmeler bekler,
 * sunucunun cumlesi uyari olarak gorunur. Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { SavedAddress } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DeleteAddressDialog } from '../../src/features/address/ui/DeleteAddressDialog';

const TEXTS = CONTENT_FALLBACK.addresses;
const ADDRESS: SavedAddress = {
  id: 'adr_00000000000000000000000000000002',
  title: 'İş',
  line: 'Barbaros Blv. 40',
  location: { lat: 41.04, lng: 29.0 },
};

const dialog = (pending: boolean, error: string | null) =>
  renderToStaticMarkup(
    createElement(DeleteAddressDialog, {
      texts: TEXTS,
      closeLabel: 'Kapat',
      address: ADDRESS,
      pending,
      error,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    }),
  );

describe('DeleteAddressDialog (T11.15)', () => {
  it('baslik, adla soru ve siparis notu; Vazgeç ve Sil', () => {
    const html = dialog(false, null);

    expect(html).toContain(TEXTS.confirmTitle);
    expect(html).toContain(`>${ADDRESS.title}</strong> ${TEXTS.confirmQuestionSuffix}`);
    expect(html).toContain(TEXTS.confirmHint);
    expect(html).toContain(`>${TEXTS.cancelLabel}</button>`);
    expect(html).toContain(`>${TEXTS.confirmLabel}</button>`);
    expect(html).not.toContain('role="alert"');
  });

  it('silme surerken dugmeler ve X bekler, "Siliniyor…"', () => {
    const html = dialog(true, null);

    expect(html).toContain(TEXTS.deletingLabel);
    expect(html).toContain('aria-busy="true"');
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(3);
  });

  it('sunucunun cumlesi uyari olarak gorunur', () => {
    expect(dialog(false, 'Aradığın kaydı bulamadık.')).toMatch(
      /role="alert"[^>]*>Aradığın kaydı bulamadık\./,
    );
  });
});
