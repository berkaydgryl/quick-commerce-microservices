/**
 * Gida urunleri (urun ve magaza cesitliligi, 07.10): her gida kategorisi
 * 8-13 urune cikar. Fiyat YOK - fiyat marketin teklifindedir (ADR-15).
 */

import type { Product } from '../../../domain/catalog.js';
import { PRODUCT_UNIT } from '../../../domain/catalog.js';
import { product } from './product.js';

export const FOOD_PRODUCTS: readonly Product[] = [
  // Sut & Kahvaltilik
  product(
    'YOGURT-1K',
    'Yoğurt 1 kg',
    'Tam yağlı, kaymaklı',
    'cat_sut-kahvaltilik',
    PRODUCT_UNIT.PIECE,
  ),
  product('AYRAN-1L', 'Ayran 1 L', 'Köpüklü, yayık', 'cat_sut-kahvaltilik', PRODUCT_UNIT.LITER),
  product(
    'BAL-450',
    'Süzme Çiçek Balı 450 g',
    'Ege yaylalarından',
    'cat_sut-kahvaltilik',
    PRODUCT_UNIT.PIECE,
  ),
  product('RECEL-380', 'Vişne Reçeli 380 g', 'Ev usulü', 'cat_sut-kahvaltilik', PRODUCT_UNIT.PIECE),
  product(
    'LABNE-200',
    'Labne 200 g',
    'Sürülebilir peynir',
    'cat_sut-kahvaltilik',
    PRODUCT_UNIT.PIECE,
  ),
  // Meyve & Sebze
  product(
    'PATATES-1K',
    'Patates 1 kg',
    'Nevşehir patatesi',
    'cat_meyve-sebze',
    PRODUCT_UNIT.KILOGRAM,
  ),
  product('SOGAN-1K', 'Kuru Soğan 1 kg', 'Yemeklik', 'cat_meyve-sebze', PRODUCT_UNIT.KILOGRAM),
  product('LIMON-500', 'Limon 500 g', 'Mersin limonu', 'cat_meyve-sebze', PRODUCT_UNIT.PACK),
  product(
    'PORTAKAL-1K',
    'Portakal 1 kg',
    'Finike portakalı',
    'cat_meyve-sebze',
    PRODUCT_UNIT.KILOGRAM,
  ),
  product('BIBER-500', 'Sivri Biber 500 g', 'Taze, acısız', 'cat_meyve-sebze', PRODUCT_UNIT.PACK),
  product('MAYDANOZ', 'Maydanoz', 'Bir demet', 'cat_meyve-sebze', PRODUCT_UNIT.PIECE),
  // Firindan
  product(
    'TAM-BUGDAY-EKMEK',
    'Tam Buğday Ekmeği 500 g',
    'Ekşi mayalı',
    'cat_firindan',
    PRODUCT_UNIT.PIECE,
  ),
  product('LAVAS-10', 'Lavaş 10’lu', 'İnce, yumuşak', 'cat_firindan', PRODUCT_UNIT.PACK),
  product(
    'POGACA-ZEYTINLI',
    'Zeytinli Poğaça',
    'Taze, yumuşak',
    'cat_firindan',
    PRODUCT_UNIT.PIECE,
  ),
  product('SU-BOREGI', 'Su Böreği 500 g', 'Peynirli, tepside', 'cat_firindan', PRODUCT_UNIT.PIECE),
  // Temel Gida
  product('NOHUT-1K', 'Nohut 1 kg', 'İri taneli', 'cat_temel-gida', PRODUCT_UNIT.PACK),
  product('UN-2K', 'Buğday Unu 2 kg', 'Çok amaçlı', 'cat_temel-gida', PRODUCT_UNIT.PACK),
  product('SEKER-1K', 'Toz Şeker 1 kg', 'Kristal', 'cat_temel-gida', PRODUCT_UNIT.PACK),
  product(
    'SALCA-830',
    'Domates Salçası 830 g',
    'Güneşte kurutulmuş',
    'cat_temel-gida',
    PRODUCT_UNIT.PIECE,
  ),
  product('BULGUR-1K', 'Pilavlık Bulgur 1 kg', 'Köy bulguru', 'cat_temel-gida', PRODUCT_UNIT.PACK),
  product('TUZ-750', 'Kaya Tuzu 750 g', 'İyotlu', 'cat_temel-gida', PRODUCT_UNIT.PACK),
  // Et & Tavuk
  product(
    'TAVUK-BAGET-1K',
    'Tavuk Baget 1 kg',
    'Taze, günlük',
    'cat_et-tavuk',
    PRODUCT_UNIT.KILOGRAM,
  ),
  product('KOFTE-500', 'Kasap Köfte 500 g', 'Dana, baharatlı', 'cat_et-tavuk', PRODUCT_UNIT.PACK),
  product('HINDI-FUME-150', 'Hindi Füme 150 g', 'Dilimlenmiş', 'cat_et-tavuk', PRODUCT_UNIT.PACK),
  product('KUZU-PIRZOLA-500', 'Kuzu Pirzola 500 g', 'Taze kuzu', 'cat_et-tavuk', PRODUCT_UNIT.PACK),
  // Icecek
  product('MADEN-SUYU-6', 'Maden Suyu 6’lı', 'Doğal mineralli', 'cat_icecek', PRODUCT_UNIT.PACK),
  product('CAY-1K', 'Siyah Çay 1 kg', 'Rize, dökme', 'cat_icecek', PRODUCT_UNIT.PACK),
  product(
    'TURK-KAHVESI-100',
    'Türk Kahvesi 100 g',
    'Orta kavrulmuş',
    'cat_icecek',
    PRODUCT_UNIT.PIECE,
  ),
  product('LIMONATA-1L', 'Limonata 1 L', 'Ev yapımı tadında', 'cat_icecek', PRODUCT_UNIT.LITER),
  product('SOGUK-CAY-330', 'Soğuk Çay 330 ml', 'Şeftalili', 'cat_icecek', PRODUCT_UNIT.PIECE),
  product('GAZOZ-1L', 'Gazoz 1 L', 'Sade', 'cat_icecek', PRODUCT_UNIT.LITER),
  product('SU-05L-6', 'Su 0,5 L 6’lı', 'Doğal kaynak suyu', 'cat_icecek', PRODUCT_UNIT.PACK),
  // Atistirmalik
  product(
    'BISKUVI-150',
    'Bisküvi 150 g',
    'Sütlü, kahvaltılık',
    'cat_atistirmalik',
    PRODUCT_UNIT.PIECE,
  ),
  product('KRAKER-100', 'Kraker 100 g', 'Tuzlu', 'cat_atistirmalik', PRODUCT_UNIT.PIECE),
  product('GOFRET-40', 'Gofret 40 g', 'Fındık kremalı', 'cat_atistirmalik', PRODUCT_UNIT.PIECE),
  product(
    'KURU-KAYISI-250',
    'Kuru Kayısı 250 g',
    'Malatya kayısısı',
    'cat_atistirmalik',
    PRODUCT_UNIT.PACK,
  ),
  product(
    'AY-CEKIRDEGI-200',
    'Ay Çekirdeği 200 g',
    'Tuzlu, kavrulmuş',
    'cat_atistirmalik',
    PRODUCT_UNIT.PACK,
  ),
  product(
    'KARISIK-KURUYEMIS-200',
    'Karışık Kuruyemiş 200 g',
    'Kavrulmuş, tuzsuz',
    'cat_atistirmalik',
    PRODUCT_UNIT.PACK,
  ),
  product('BADEM-200', 'Badem 200 g', 'Kavrulmuş iç badem', 'cat_atistirmalik', PRODUCT_UNIT.PACK),
  // Dondurma
  product(
    'DONDURMA-KULAH',
    'Külah Dondurma',
    'Vanilyalı, çikolata kaplı',
    'cat_dondurma',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'DONDURMA-MARAS-500',
    'Maraş Dondurması 500 g',
    'Sade, dövme',
    'cat_dondurma',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'DONDURMA-MEYVELI',
    'Meyveli Çubuk Dondurma',
    'Çilekli',
    'cat_dondurma',
    PRODUCT_UNIT.PIECE,
  ),
  product('DONDURMA-SANDVIC', 'Sandviç Dondurma', 'Bisküvili', 'cat_dondurma', PRODUCT_UNIT.PIECE),
  product(
    'DONDURMA-VANILYA-1L',
    'Vanilyalı Dondurma 1 L',
    'Aile boyu',
    'cat_dondurma',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'DONDURMA-ANTEP-500',
    'Antep Fıstıklı Dondurma 500 ml',
    'Gerçek fıstıklı',
    'cat_dondurma',
    PRODUCT_UNIT.PIECE,
  ),
];
