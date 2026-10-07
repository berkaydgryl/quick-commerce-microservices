/**
 * Ev, bakim, bebek ve evcil hayvan urunleri (urun ve magaza cesitliligi,
 * 07.10): her kategori 8-11 urune cikar. Fiyat YOK (ADR-15).
 */

import type { Product } from '../../../domain/catalog.js';
import { PRODUCT_UNIT } from '../../../domain/catalog.js';
import { product } from './product.js';

export const HOME_PRODUCTS: readonly Product[] = [
  // Temizlik
  product(
    'CAMASIR-DETERJANI-4K',
    'Çamaşır Deterjanı 4 kg',
    'Toz, renkliler için',
    'cat_temizlik',
    PRODUCT_UNIT.PACK,
  ),
  product(
    'YUMUSATICI-15L',
    'Yumuşatıcı 1,5 L',
    'Bahar ferahlığı',
    'cat_temizlik',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'YUZEY-TEMIZLEYICI',
    'Yüzey Temizleyici 1 L',
    'Çok amaçlı',
    'cat_temizlik',
    PRODUCT_UNIT.PIECE,
  ),
  product('CAM-TEMIZLEYICI', 'Cam Temizleyici 500 ml', 'Sprey', 'cat_temizlik', PRODUCT_UNIT.PIECE),
  product(
    'BULASIK-TABLET-30',
    'Bulaşık Makinesi Tableti 30’lu',
    'Hepsi bir arada',
    'cat_temizlik',
    PRODUCT_UNIT.PACK,
  ),
  product('SUNGER-3', 'Bulaşık Süngeri 3’lü', 'Çizmeyen yüz', 'cat_temizlik', PRODUCT_UNIT.PACK),
  // Kisisel Bakim
  product('DIS-FIRCASI', 'Diş Fırçası', 'Orta sertlik', 'cat_kisisel-bakim', PRODUCT_UNIT.PIECE),
  product('DUS-JELI-500', 'Duş Jeli 500 ml', 'Lavanta', 'cat_kisisel-bakim', PRODUCT_UNIT.PIECE),
  product('DEODORANT-150', 'Deodorant 150 ml', 'Sprey', 'cat_kisisel-bakim', PRODUCT_UNIT.PIECE),
  product(
    'TIRAS-KOPUGU',
    'Tıraş Köpüğü 200 ml',
    'Hassas ciltler için',
    'cat_kisisel-bakim',
    PRODUCT_UNIT.PIECE,
  ),
  product('PAMUK-100', 'Pamuk 100 g', 'Hidrofil', 'cat_kisisel-bakim', PRODUCT_UNIT.PACK),
  // Ev & Yasam (son ucu cicekcinin)
  product(
    'TUVALET-KAGIDI-16',
    'Tuvalet Kağıdı 16’lı',
    'Çift katlı',
    'cat_ev-yasam',
    PRODUCT_UNIT.PACK,
  ),
  product('PECETE-100', 'Peçete 100’lü', 'Beyaz', 'cat_ev-yasam', PRODUCT_UNIT.PACK),
  product(
    'ALUMINYUM-FOLYO',
    'Alüminyum Folyo 10 m',
    'Mutfak için',
    'cat_ev-yasam',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'LALE-BUKET',
    'Lale Buketi',
    'On dal, mevsim renkleri',
    'cat_ev-yasam',
    PRODUCT_UNIT.PIECE,
  ),
  product('SUKULENT-SAKSI', 'Saksıda Sukulent', 'Küçük boy', 'cat_ev-yasam', PRODUCT_UNIT.PIECE),
  product('AYCICEGI-BUKET', 'Ayçiçeği Buketi', 'Beş dal', 'cat_ev-yasam', PRODUCT_UNIT.PIECE),
  // Bebek
  product(
    'BEBEK-SAMPUANI',
    'Bebek Şampuanı 300 ml',
    'Göz yakmayan',
    'cat_bebek',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'BEBEK-BISKUVISI',
    'Bebek Bisküvisi 150 g',
    '6 ay ve üzeri',
    'cat_bebek',
    PRODUCT_UNIT.PIECE,
  ),
  product('BIBERON-250', 'Biberon 250 ml', 'Kolik önleyici', 'cat_bebek', PRODUCT_UNIT.PIECE),
  product(
    'BEBEK-BEZI-5',
    'Bebek Bezi 5 Numara 36’lı',
    'Gece ve gündüz',
    'cat_bebek',
    PRODUCT_UNIT.PACK,
  ),
  product('PISIK-KREMI', 'Pişik Kremi 100 ml', 'Çinko oksitli', 'cat_bebek', PRODUCT_UNIT.PIECE),
  product('KASIK-MAMASI', 'Kaşık Maması 200 g', 'Sütlü pirinç', 'cat_bebek', PRODUCT_UNIT.PIECE),
  // Evcil Hayvan
  product(
    'KEDI-YAS-MAMA',
    'Kedi Maması Yaş 85 g',
    'Tavuklu',
    'cat_evcil-hayvan',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'KOPEK-ODUL',
    'Köpek Ödül Maması 150 g',
    'Kemik biçiminde',
    'cat_evcil-hayvan',
    PRODUCT_UNIT.PACK,
  ),
  product(
    'KUS-YEMI-500',
    'Kuş Yemi 500 g',
    'Muhabbet kuşu için',
    'cat_evcil-hayvan',
    PRODUCT_UNIT.PACK,
  ),
  product('BALIK-YEMI', 'Balık Yemi 50 g', 'Pul yem', 'cat_evcil-hayvan', PRODUCT_UNIT.PIECE),
  product(
    'KEDI-ODUL-CUBUK',
    'Kedi Ödül Çubuğu 3’lü',
    'Somonlu',
    'cat_evcil-hayvan',
    PRODUCT_UNIT.PACK,
  ),
];
