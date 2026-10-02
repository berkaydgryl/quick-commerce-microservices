/**
 * "/" kapisi (T11.8): oturum ve adres defterine gore hangi ekran. Kullanicinin
 * kurali: yeni kayit da, adressiz eski hesap da once adres ekler; adresi olan
 * dogrudan girer.
 */

import type { SavedAddress } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { rootView } from '../../src/features/address/services/address-gate';

const EV: SavedAddress = {
  title: 'Ev',
  line: 'Moda Caddesi',
  location: { lat: 40.98, lng: 29.02 },
};

describe('rootView', () => {
  it('oturum belli olmadan hicbir sey cizilmez (karsilama bir an gorunmesin)', () => {
    expect(rootView('unknown', 'loading')).toBe('wait');
  });

  it('oturumsuz ziyaretci karsilama ekranini gorur', () => {
    expect(rootView('anonymous', 'loading')).toBe('welcome');
  });

  it('defter okunurken beklenir (adresi olan kullanici adres penceresini gormesin)', () => {
    expect(rootView('authenticated', 'loading')).toBe('wait');
  });

  it('adresi olmayan hesap once adres ekler', () => {
    expect(rootView('authenticated', [])).toBe('address-setup');
  });

  it('en az bir adresi olan dogrudan ana sayfaya girer', () => {
    expect(rootView('authenticated', [EV])).toBe('home');
  });

  it('defter okunamazsa ana sayfa (varsayilan adresle); uygulama kilitlenmez', () => {
    expect(rootView('authenticated', 'error')).toBe('home');
  });
});
