/**
 * Demo verisi: platform kategorileri. Bkz. ../fixtures.ts (tek giris noktasi).
 */

import type { Category } from '../../domain/catalog.js';

/**
 * Platform kategorileri (T11.6 PR 3'ten beri 13): once gida, sonra ev ve kisisel
 * bakim; ilk bestekinin birbirine gore sirasi korundu. T11.11'den beri her
 * kategorinin urunu var; market sayfasi yine yalnizca o marketin teklifi olan
 * kategorileri gosterir (ListMarketCategories).
 * Gorseller web'in public/img/cat klasorundedir (CC0, apps/web/README.md).
 */
export const CATEGORIES: readonly Category[] = [
  {
    id: 'cat_sut-kahvaltilik',
    name: 'Süt & Kahvaltılık',
    slug: 'sut-kahvaltilik',
    sortOrder: 1,
    imageUrl: '/img/cat/sut.jpg',
  },
  {
    id: 'cat_meyve-sebze',
    name: 'Meyve & Sebze',
    slug: 'meyve-sebze',
    sortOrder: 2,
    imageUrl: '/img/cat/manav.jpg',
  },
  {
    id: 'cat_firindan',
    name: 'Fırından',
    slug: 'firindan',
    sortOrder: 3,
    imageUrl: '/img/cat/firindan.jpg',
  },
  {
    id: 'cat_temel-gida',
    name: 'Temel Gıda',
    slug: 'temel-gida',
    sortOrder: 4,
    imageUrl: '/img/cat/temel-gida.jpg',
  },
  {
    id: 'cat_et-tavuk',
    name: 'Et & Tavuk',
    slug: 'et-tavuk',
    sortOrder: 5,
    imageUrl: '/img/cat/et-tavuk.jpg',
  },
  {
    id: 'cat_icecek',
    name: 'İçecek',
    slug: 'icecek',
    sortOrder: 6,
    imageUrl: '/img/cat/icecek.jpg',
  },
  {
    id: 'cat_atistirmalik',
    name: 'Atıştırmalık',
    slug: 'atistirmalik',
    sortOrder: 7,
    imageUrl: '/img/cat/atistirmalik.jpg',
  },
  {
    id: 'cat_dondurma',
    name: 'Dondurma',
    slug: 'dondurma',
    sortOrder: 8,
    imageUrl: '/img/cat/dondurma.jpg',
  },
  {
    id: 'cat_temizlik',
    name: 'Temizlik',
    slug: 'temizlik',
    sortOrder: 9,
    imageUrl: '/img/cat/temizlik.jpg',
  },
  {
    id: 'cat_kisisel-bakim',
    name: 'Kişisel Bakım',
    slug: 'kisisel-bakim',
    sortOrder: 10,
    imageUrl: '/img/cat/kisisel-bakim.jpg',
  },
  {
    id: 'cat_ev-yasam',
    name: 'Ev & Yaşam',
    slug: 'ev-yasam',
    sortOrder: 11,
    imageUrl: '/img/cat/ev-yasam.jpg',
  },
  {
    id: 'cat_bebek',
    name: 'Bebek',
    slug: 'bebek',
    sortOrder: 12,
    imageUrl: '/img/cat/bebek.jpg',
  },
  {
    id: 'cat_evcil-hayvan',
    name: 'Evcil Hayvan',
    slug: 'evcil-hayvan',
    sortOrder: 13,
    imageUrl: '/img/cat/evcil-hayvan.jpg',
  },
];
