/**
 * Demo verisi: platform kategorileri ve ORTAK urunler (fiyatsiz - ADR-15).
 * Bkz. ../fixtures.ts (tek giris noktasi ve gerekce).
 *
 * Dosya boyutu kurali geregi parcalara bolunmustur: kategoriler
 * categories.ts'te, urunler products/ altinda eklenme sirasiyla (ilk 49 urun
 * basta, 07.10 cesitliligi sonda). inventory ve courier testleri bu dosyayi
 * okur: disa verilen adlar degismez.
 */

import type { Product } from '../../domain/catalog.js';
import { FOOD_PRODUCTS } from './products/food.js';
import { HOME_PRODUCTS } from './products/home.js';
import { INITIAL_PRODUCTS } from './products/initial.js';

export { CATEGORIES } from './categories.js';

/** Ortak urunler: fiyat YOK - fiyat marketin teklifindedir (ADR-15). */
export const PRODUCTS: readonly Product[] = [
  ...INITIAL_PRODUCTS,
  ...FOOD_PRODUCTS,
  ...HOME_PRODUCTS,
];
