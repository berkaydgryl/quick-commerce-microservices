/**
 * Sepet sayfasinin adres karti (T16.3; referans getircarsi): adresin tam
 * metni (satir, bina, kat, daire; etiketler adres formundan) ve kart (baslik,
 * ad, metin; kayitli adres yoksa not). Metinler icerik yedeginden.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { SavedAddress } from '@getir/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { addressFullText } from '../../src/features/address/services/address-text';
import { DeliveryAddressCard } from '../../src/features/address/ui/DeliveryAddressCard';

const LABELS = { buildingLabel: 'Bina', floorLabel: 'Kat', apartmentLabel: 'Daire' };
const PAGE = CONTENT_FALLBACK.cartPage;

const EV: SavedAddress = {
  id: 'adr_ev',
  title: 'Ev',
  kind: 'HOME',
  line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
  location: { lat: 40.9885, lng: 29.0262 },
  building: '6A',
  floor: '2',
  apartment: '2',
  note: 'Zili çalma',
};

describe('addressFullText (T16.3)', () => {
  it('satir, sonra bina, kat, daire; adres tarifi girmez', () => {
    expect(addressFullText(EV, LABELS)).toBe(
      'Caferağa Mah. Moda Cad. No:12, Kadıköy, Bina: 6A, Kat: 2, Daire: 2',
    );
  });

  it('olmayan ya da bos parca yazilmaz', () => {
    const { building: _b, apartment: _a, ...yalin } = EV;

    expect(addressFullText({ ...yalin, floor: '  ' }, LABELS)).toBe(
      'Caferağa Mah. Moda Cad. No:12, Kadıköy',
    );
  });
});

describe('DeliveryAddressCard (T16.3)', () => {
  const render = (address: SavedAddress | undefined) =>
    renderToStaticMarkup(
      createElement(DeliveryAddressCard, {
        address,
        label: 'Ev',
        texts: { title: PAGE.addressTitle, noAddressNotice: PAGE.noAddressNotice },
        partLabels: LABELS,
      }),
    );

  it('"Adres" basligi (h2), ad ve tam metin', () => {
    const markup = render(EV);

    expect(markup).toMatch(
      /<section[^>]*aria-labelledby="([^"]+)"[\s\S]*<h2 id="\1"[^>]*>Adres<\/h2>/,
    );
    expect(markup).toContain('>Ev</p>');
    expect(markup).toContain('Daire: 2</p>');
  });

  it('kayitli adres yoksa adin altinda not', () => {
    expect(render(undefined)).toContain(`>${PAGE.noAddressNotice}</p>`);
  });
});
