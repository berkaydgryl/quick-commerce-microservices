# ADR-03: Stogun kalici gercegi Mongo'da, hizli sayaci Redis'te durur

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Stok iki celisen ihtiyaca ayni anda cevap vermek zorundadir. Sicak yolda her sepet
isleminde milisaniyenin altinda okunup dusurulmesi gerekir; ayni zamanda her hareketin
denetlenebilir, kalici ve yeniden hesaplanabilir bir kaydi olmalidir. Her istekte
Mongo'ya kosullu guncelleme atmak gecikme ve replica set yuku uretir; her seyi yalnizca
Redis'te tutmak ise Redis kaybinda mali kayit birakmaz ve "bu urun neden eksildi"
sorusunu cevapsiz birakir.

## Karar

Kalici gercek Mongo'dadir: stock koleksiyonu (dark store x SKU icin mevcut miktar) ve
stock_ledger koleksiyonu (yalnizca ekleme yapilan hareket defteri; her rezervasyon,
iade, kesin dusum ve mal kabulu birer satirdir). Hizli sayac Redis'tedir ve sicak yolda
karar mercii bu sayactir. Servis acilisinda Redis sayaci Mongo stock kayitlarindan seed
edilir; seed bitmeden servis hazir (ready) sayilmaz. Periyodik reconciliation, Mongo
tarafindaki gercegi Redis sayaci ile karsilastirir, farki metrik olarak yayinlar ve
uyusmazlikta Mongo'yu otorite kabul ederek Redis'i duzeltir.

## Gerekce

Karar yolu ile kayit yolunu ayirmak her birini dogru araca oturtur: O(1) atomik sayac
icin Redis, denetim ve yeniden insa icin yalnizca eklemeli defter. Defter sayesinde
sayac her an sifirdan turetilebilir; yani Redis kaybi veri kaybi degil, sadece yeniden
isinma maliyetidir. Tek depolu alternatifler elendi: "sadece Mongo" sicak yolu
yavaslatir ve demo yuku altinda kuyruk olusturur, "sadece Redis" ise denetimi ve
kurtarmayi imkansiz kilar.

## Sonuclari

- Olumlu: sicak yol hizli, gecmis denetlenebilir; Redis'i tamamen bosaltmak guvenli ve
  gosterilebilir bir islem haline gelir.
- Olumsuz: iki depo arasinda kisa bir tutarsizlik penceresi vardir. Reconciliation bu
  pencereyi kapatir ama gizlemez: farklar metrikte gorunur kalir ve sifirdan sapma bir
  hata sinyalidir.
- Kabul edilen borc: seed ve reconciliation isleri liderlik gerektirir; hareket
  defterinin buyumesi icin arsivleme bugun planlanmadi.

## Ilgili

ADR-01, ADR-02, ADR-05; gorev T1.5.

## Ek (T9.1-T9.2, 2026-09-29): acilis seed'inin bicimi

Ustteki karar degismez; "sayac acilista Mongo'dan seed edilir" cumlesini netlestirir. Uygulayan
`apps/inventory-service` (`infrastructure/stock-source.ts`, `application/seed-counters.ts`).

- Acilis seed'i yalnizca OLMAYAN sayaci yazar (`SET NX`). Var olan sayac rezervasyonlari yansitir
  (T10); her acilista ezilseydi ayrilmis stok yeniden satilirdi.
- Hepsini bastan yazmak bilincli bir komuttur: `reseed` (Redis bosaltildiginda ya da
  kaybedildiginde) ve `seed` (kalici stok topluca degistiginde). T10'dan sonra `reseed` aktif
  rezervasyon varken kosulmaz.
- "Seed bitmeden servis hazir sayilmaz": sayaclar gRPC portu acilmadan ONCE yazilir; port kapaliyken
  saglik yoklamasi da basarisizdir.
- Redis'in `maxmemory-policy`'si `noeviction` degilse ya da okunamiyorsa servis acilmaz (roadmap
  P1): tahliye eden bir Redis sayaci silebilir; bu fazla satistir.
- Kayitlar Mongo'dan kacar kacar (500) okunur ve tek boru hattinda yazilir; butun koleksiyon
  bellege alinmaz.

## Ek (T10.1 PR 2, 2026-09-30): Redis bosalinca

Ustteki karar degismez. "Redis kaybi veri kaybi degil, yeniden isinma maliyetidir" cumlesi artik
kendiliginden isler: sayaclar yazildiktan sonra konan bir isaret (stock:seeded) sayesinde servis,
bulunamayan bir sayacin "bu markette yok" mu yoksa "Redis bosaldi" mi oldugunu ayirir ve ikincisinde
sayaclari Mongo'dan yeniden yazar. Isaret TTL'sizdir; gerekcesi ve kurallari ADR-17'de.

## Ek (T10.2, 2026-10-01): rezervasyonun sonuclanmasi ve stok defteri

Ustteki karar degismez. Rezervasyon birakilinca (T10.2 PR 1; onay PR 2'de) sayaclar Redis'te
hareket eder, kalici kayit Mongo'daki stok defterine (`stock_ledger`) duser. Iki deponun sirasi,
yarida kalan kaydin tamamlanmasi ve defterin eldeki adetle (onHand) tutmasi ADR-18'de.
