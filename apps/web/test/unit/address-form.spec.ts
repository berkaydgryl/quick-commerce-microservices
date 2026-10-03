/**
 * Adres ekleme formu (T11.8): acilis degerleri, turle gelen baslik, istek
 * govdesi ve sozlesmenin kurallari (mesajlar gateway'le ayni cumle).
 */

import type { AddressKindOption } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  addressFormSchema,
  initialAddressValues,
  titleForKind,
  toCreateAddressRequest,
  uniqueTitle,
} from '../../src/features/address/services/address-form';

const KINDS: readonly AddressKindOption[] = [
  { kind: 'HOME', label: 'Ev', icon: '🏠' },
  { kind: 'WORK', label: 'İş', icon: '🏢' },
  { kind: 'OTHER', label: 'Diğer', icon: '📍' },
];
const LOCATION = { lat: 40.9885, lng: 29.027 };

describe('initialAddressValues', () => {
  it('ilk tur secili, baslik onun etiketi; satir haritadan', () => {
    expect(initialAddressValues(KINDS, 'Moda Caddesi, Kadıköy')).toEqual({
      kind: 'HOME',
      title: 'Ev',
      line: 'Moda Caddesi, Kadıköy',
      building: '',
      floor: '',
      apartment: '',
      note: '',
    });
  });
});

describe('titleForKind', () => {
  it('baslik bir turun etiketiyse ya da bossa yeni turun etiketi olur', () => {
    expect(titleForKind(KINDS, 'Ev', 'WORK')).toBe('İş');
    expect(titleForKind(KINDS, '  ', 'OTHER')).toBe('Diğer');
  });

  it('kullanicinin yazdigi baslik tur degisince korunur', () => {
    expect(titleForKind(KINDS, 'Annemler', 'WORK')).toBe('Annemler');
  });
});

describe('addressFormSchema', () => {
  const valid = initialAddressValues(KINDS, 'Moda Caddesi, Kadıköy');

  it('metinleri kirpar; bina, kat, daire ve tarif istege bagli', () => {
    const parsed = addressFormSchema.parse({ ...valid, title: '  Ev  ' });
    expect(parsed.title).toBe('Ev');
  });

  it.each([
    ['title', '', 'Başlık boş olamaz'],
    ['title', 'x'.repeat(41), 'Başlık en fazla 40 karakter olabilir'],
    ['line', ' ', 'Adres boş olamaz'],
    ['building', 'x'.repeat(21), 'Bina en fazla 20 karakter olabilir'],
    ['floor', 'x'.repeat(21), 'Kat en fazla 20 karakter olabilir'],
    ['apartment', 'x'.repeat(21), 'Daire en fazla 20 karakter olabilir'],
    ['note', 'x'.repeat(241), 'Adres tarifi en fazla 240 karakter olabilir'],
  ])('%s: %j -> "%s"', (field, value, message) => {
    const parsed = addressFormSchema.safeParse({ ...valid, [field]: value });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({ path: [field], message });
  });
});

describe('toCreateAddressRequest', () => {
  it('konum haritadan eklenir; bos istege bagli alan istege yazilmaz', () => {
    const values = addressFormSchema.parse({
      ...initialAddressValues(KINDS, 'Moda Caddesi'),
      building: ' 19C3 ',
      note: '',
    });

    expect(toCreateAddressRequest(values, LOCATION)).toEqual({
      title: 'Ev',
      kind: 'HOME',
      line: 'Moda Caddesi',
      location: LOCATION,
      building: '19C3',
    });
  });
});

describe('uniqueTitle ve defterdeki adlar (T11.10: ust bardan ikinci adres)', () => {
  it('defterde olmayan ad oldugu gibi, varsa siradaki numara', () => {
    expect(uniqueTitle('Ev', [])).toBe('Ev');
    expect(uniqueTitle('Ev', ['Ev'])).toBe('Ev 2');
    expect(uniqueTitle('Ev', ['Ev', 'Ev 2', 'Ev 3'])).toBe('Ev 4');
  });

  it('acilista "Ev" doluysa "Ev 2" onerilir', () => {
    expect(initialAddressValues(KINDS, 'Moda', ['Ev']).title).toBe('Ev 2');
  });

  it('onerilen numarali ad da ture uyar; "İş" doluysa "İş 2"', () => {
    expect(titleForKind(KINDS, 'Ev 2', 'WORK', ['Ev', 'İş'])).toBe('İş 2');
    expect(titleForKind(KINDS, 'Annemler 2', 'WORK', ['Ev'])).toBe('Annemler 2');
  });
});
