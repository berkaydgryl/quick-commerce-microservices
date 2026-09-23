# @getir/pricing

Sepet hesabı — **web ve order-service aynı fonksiyonu çağırır.** İki yerde ayrı hesap iki farklı
toplam demektir: ekranda görülen ile ödenen tutmazsa sipariş `PRICE_CHANGED` ile reddedilir
(T7.2).

## Kullanım

```ts
import { calculateCart } from '@getir/pricing';

const totals = calculateCart({
  lines: [{ productId: 'prd_sut-1l', unitPriceMinor: 3490, quantity: 3 }], // fiyat O MARKETIN teklifi
  rules: market.pricingRules, // markete özel kurallar (ADR-15)
  context: { isFirstOrder: true }, // kupon koşulu için; pricing sorgulamaz, çağıran verir
  couponCode: 'ILK10',
});
// { subtotalMinor: 10470, discountMinor: 1047, deliveryFeeMinor: 2490, totalMinor: 11913,
//   canCheckout: true, amountToMinBasketMinor: 0, amountToFreeDeliveryMinor: 19530,
//   coupon: { code: 'ILK10', applied: true } }
```

## Kurallar marketten gelir (ADR-15)

Minimum sepet, teslimat ücreti ve ücretsiz teslimat eşiği **parametredir** (`market.pricingRules`);
paket sabit okumaz. Gerçek hayatta her market bu değerleri kendi panelinden girer; panel kapsam
dışı olduğu için bugün seed'den gelirler. Panel geldiğinde yalnızca kaynak değişir, bu paket
değişmez.

Platform sabitleri yalnızca kuponlara aittir (`constants.ts`). Ürün başına en fazla adet
(99) burada **değil**, `@getir/contracts` `CART_ITEM_MAX_QUANTITY`'dedir ve sınırda şema
uygular — iki kaynak birbirinden ayrılmasın.

## Hesap sırası (roadmap B12, sabit)

1. **Ara toplam** — birim fiyat × adet.
2. **Ürün indirimi** (ILK10: %10, en çok 30 TL; kuruş altı aşağı yuvarlanır).
3. **Teslimat ücreti** — ücretsiz teslimat eşiği **indirim öncesi** ara toplama bakar.
4. **Kargo kuponu** (KARGOBEDAVA: ara toplam ≥ 150 TL) — teslimatı sıfırlar.
5. **Toplam** = max(0, ara toplam − indirim + teslimat).

Eşik indirimden önce ölçüldüğü için eşik üstü sepet + kargo kuponu çift indirim üretemez;
indirim teslimatı geri ücretli yapamaz. **Minimum sepet de ara toplama bakar:** kupon, sepeti
minimumun altına düşürüp siparişi engellemez.

## Kuponlar hata fırlatmaz

Geçersiz kupon bir **sonuçtur**: `{ code, applied: false, reason }` —
`UNKNOWN_CODE`, `NOT_FIRST_ORDER`, `BELOW_MIN_SUBTOTAL`. Sunucu bunu `COUPON_INVALID`'e,
istemci kullanıcı mesajına çevirir. Hata fırlatılan tek durum programcı/veri hatasıdır (negatif
ya da kuruş dışı tutar, sıfır adet, bozuk market kuralı) → `VALIDATION_FAILED`.

Kod karşılaştırması büyük/küçük harf ve boşluktan bağımsızdır, **yerel ayarsız** büyük harfle:
`toLocaleUpperCase('tr')` `"ilk10"`'u `"İLK10"` yapardı ve kupon hiç eşleşmezdi.

## Saf

Ağ, veritabanı ve saat yok; tek bağımlılık `@getir/core` (`AppError`). Testler:
`test/unit/calculate-cart.spec.ts` (22 senaryo, B12 dahil).
