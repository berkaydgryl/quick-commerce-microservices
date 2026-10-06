/**
 * Kart metinlerinin ekran okuyucu hali (T11.17, QA D6 ve K4): silme sorusu ve
 * bildirimler maskeyi ("Visa •••• 4242") degil "Visa, son dört hane 4242"yi
 * okutur; gorunen maske aria-hidden. Okunan metni olmayan bildirim ve onay
 * (adres silme gibi) eskisi gibi.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DeleteCardDialog } from '../../src/features/cards/ui/DeleteCardDialog';
import { ToasterView } from '../../src/shared/ui/toast/Toaster';

import { VISA_CARD } from './card-test-support';

const TEXTS = CONTENT_FALLBACK.paymentMethods;
const noop = () => undefined;

describe('kart metinleri ekran okuyucuda (QA K4)', () => {
  it('silme sorusu: gorunen "Visa •••• 4242" gizli, okunan "Visa, son dört hane 4242"', () => {
    const html = renderToStaticMarkup(
      createElement(DeleteCardDialog, {
        texts: TEXTS,
        closeLabel: TEXTS.closeLabel,
        card: VISA_CARD,
        pending: false,
        error: null,
        onConfirm: noop,
        onCancel: noop,
      }),
    );

    expect(html).toContain('<span aria-hidden="true">Visa •••• 4242</span>');
    expect(html).toMatch(
      /__spoken[^"]*">Visa, son dört hane 4242<\/span><\/strong> kartını silmek/,
    );
  });

  it('bildirim: okunan metin varsa gorunen gizli; yoksa duz metin', () => {
    const html = renderToStaticMarkup(
      createElement(ToasterView, {
        toasts: [
          {
            id: 1,
            message: 'Visa •••• 4242 kartı silindi.',
            spoken: 'Visa, son dört hane 4242 kartı silindi.',
          },
          { id: 2, message: 'Favorilere eklenemedi.' },
        ],
        dismissLabel: 'Kapat',
        onDismiss: noop,
      }),
    );

    expect(html).toContain('<span aria-hidden="true">Visa •••• 4242 kartı silindi.</span>');
    expect(html).toMatch(/__spoken[^"]*">Visa, son dört hane 4242 kartı silindi\.<\/span>/);
    expect(html).toMatch(/__message[^"]*">Favorilere eklenemedi\.<\/p>/);
  });
});
