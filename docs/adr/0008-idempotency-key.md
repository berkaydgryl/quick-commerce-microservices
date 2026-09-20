# ADR-08: Tum mutasyon uclari Idempotency-Key ister

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Ayni niyetin sisteme birden fazla kez ulasmasi istisna degil, normaldir: musteri "Siparisi
tamamla" dugmesine iki kez basar, mobil aginda kopan istek istemci tarafindan yeniden
denenir, gateway zaman asiminda istegi tekrarlar ve olay hatti en az bir kez teslim eder
(ADR-04). Bu tekrarlarin her biri ikinci bir siparis, ikinci bir cekim ya da ikinci bir
rezervasyon yaratirsa sistem musterinin parasiyla ve depodaki gercek stokla oynamis olur.

## Karar

Siparis olusturma, odeme baslatma ve rezervasyon dahil butun mutasyon uclari zorunlu
Idempotency-Key basligi ister; anahtari istemci uretir ve niyet basina tektir. Uc, ise
baslamadan once anahtari Redis'e NX ile in-progress olarak yazar. Yazim basarisizsa iki
durum vardir: kayitli bir sonuc varsa ayni yanit aynen dondurulur, hala in-progress ise
istek "islem suruyor" olarak reddedilir. Is bittiginde durum kodu ve yanit ozeti ayni
anahtara TTL ile yazilir. Anahtar bulunmayan mutasyon istegi 400 ile reddedilir.

## Gerekce

Yalnizca sonucu onbelleklemek yetmez: iki kopya istek ayni anda geldiginde ikisi de
"kayit yok" gorup birlikte calisir, yani klasik cift tiklama tam olarak korunmasiz kalan
durumdur. Once in-progress isaretini koymak, yarisin kaybedenini daha is baslamadan
durdurur ve bunu tek atomik komutla yapar. Alternatif olarak dogal anahtar (musteri +
sepet ozeti) uzerinden tekillestirme dusunuldu ama elendi: mesru ikinci siparisi de
engeller ve ozetin nasil hesaplandigina bagli kirilgan bir kurala donusur.

## Sonuclari

- Olumlu: tekrarlanan istek zararsizdir; yeniden deneme, istemcide ve gateway'de guvenle
  acilabilir; tuketiciler icin de ayni desen olay id'si uzerinden kullanilir.
- Olumsuz: istemci anahtar uretmek zorundadir ve bu sozlesmede acikca belgelenir.
  Saklanan yanit boyutu sinirlidir, buyuk govdeler ozetlenerek tutulur.
- Kabul edilen borc: process arada cokerse in-progress isareti TTL dolana kadar kalir ve
  o niyet gecici olarak bloke olur; TTL degeri sabit olarak yapilandirilir.

## Ilgili

ADR-01, ADR-04, ADR-09; gorev T1.5.
