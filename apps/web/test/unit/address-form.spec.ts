/**
 * Adres ekleme formu (T11.8): acilis degerleri, turle gelen baslik, istek
 * govdesi ve sozlesmenin kurallari (mesajlar gateway'le ayni cumle). T11.15:
 * turu secili ekleme ve duzenlemenin degerleri.
 */

import type { AddressKindOption, SavedAddress } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  addressFormSchema,
  editAddressValues,
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

describe('Adreslerim (T11.15): turu secili ekleme ve duzenleme', () => {
  it('"İş adresi ekle": tur secili, baslik turun adi; doluysa "İş 2" (T4)', () => {
    expect(initialAddressValues(KINDS, 'Levent', [], 'WORK')).toMatchObject({
      kind: 'WORK',
      title: 'İş',
      line: 'Levent',
    });
    expect(initialAddressValues(KINDS, 'Levent', ['Ev', 'İş'], 'WORK').title).toBe('İş 2');
    expect(initialAddressValues(KINDS, '', [], 'OTHER').title).toBe('Diğer');
  });

  it('icerikte olmayan tur ilk ture duser', () => {
    expect(initialAddressValues(KINDS.slice(0, 1), '', [], 'WORK')).toMatchObject({
      kind: 'HOME',
      title: 'Ev',
    });
  });

  const kayitli: SavedAddress = {
    id: 'adr_00000000000000000000000000000002',
    title: 'Ofis',
    kind: 'WORK',
    line: 'Barbaros Blv. 40',
    location: LOCATION,
    floor: '3',
    note: 'Resepsiyon',
  };

  it('duzenleme kayitli degerlerle acilir; bos alan bos metin', () => {
    expect(editAddressValues(kayitli)).toEqual({
      kind: 'WORK',
      title: 'Ofis',
      line: 'Barbaros Blv. 40',
      building: '',
      floor: '3',
      apartment: '',
      note: 'Resepsiyon',
    });
  });

  it('nokta degistiyse satir yeni noktanin satiri; turu olmayan eski kayit "Ev" turuyle', () => {
    expect(editAddressValues(kayitli, 'Levent').line).toBe('Levent');
    const { kind: _kind, ...turusuz } = kayitli;
    expect(editAddressValues(turusuz).kind).toBe('HOME');
  });
});
