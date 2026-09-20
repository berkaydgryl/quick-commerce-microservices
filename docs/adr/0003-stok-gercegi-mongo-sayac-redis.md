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
