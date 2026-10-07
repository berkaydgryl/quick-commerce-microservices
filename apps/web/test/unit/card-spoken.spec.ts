/**
 * Kart metinlerinin ekran okuyucu hali (T11.17, QA D6 ve K4): bildirimler
 * maskeyi ("Visa •••• 4242") degil "Visa, son dört hane 4242"yi okutur; gorunen
 * maske aria-hidden. Okunan metni olmayan bildirim eskisi gibi. Silme sorusu
 * F13'ten beri duz cumle (onay-penceresi.spec).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ToasterView } from '../../src/shared/ui/toast/Toaster';

const noop = () => undefined;

describe('kart metinleri ekran okuyucuda (QA K4)', () => {
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
