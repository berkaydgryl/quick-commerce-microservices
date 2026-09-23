# ADR-15: Is modeli pazaryeridir (dark store degil)

- Durum: Kabul edildi
- Tarih: 2026-09-23
- Yerini aldigi varsayim: roadmap'in ilk surumundeki "Getir'in kendi dark store'lari" modeli

## Baglam

Roadmap'in ilk surumu klasik GetirMarket modelini kurguluyordu: urunler sirketin kendi
depolarindan cikar, kullanici depo SECMEZ, sistem en yakin depoyu atar (ResolveDarkStore),
tek bir katalog ve magazadan bagimsiz tek bir liste fiyati vardir, minimum sepet ve
teslimat ucreti her yerde aynidir. T4.1 ve T4.2 bu modelle yazildi.

Urunun ekran tasarimi (kullanicinin Desktop'taki GetirMarket ekran goruntuleri) ise baska
bir modeli gosteriyor: "Yakindaki Marketler" listesi (Migros Jet, A101, Kardesler Manavi),
her marketin kendi puani, mesafesi, teslimat suresi ve minimum tutari ("Min. Tutar 40 TL"),
kullanicinin marketi kendisinin secmesi ve her marketin kendi urun fiyatlari. Bu, Getir
Carsi / Yemeksepeti Market tipi bir PAZARYERIDIR. Iki model birbirine tasarim uzerinden
uydurulamaz: fiyatin, minimum sepetin ve katalogun kime ait oldugu farklidir.

## Karar

Is modeli pazaryeridir. Tam kapsam, markete ozel urun fiyati dahil:

1. **Market** (eski adiyla dark store) bagimsiz bir saticidir: marka, logo, konum, teslimat
   yaricapi, acik/kapali durumu, teslimat suresi araligi, puan ve KENDI fiyat kurallari
   (minimum sepet, teslimat ucreti, ucretsiz teslimat esigi).
2. **Kullanici marketi kendisi secer.** Adres, hangi marketlerin listelenecegini belirler
   (konuma hizmet verenler, yakindan uzaga); sistem market atamaz.
3. **Urun ortak, fiyat markete ozeldir.** Ortak urun katalogu (sku, ad, birim, gorsel,
   kategori) bir kez tutulur; bir marketin o urunu hangi fiyatla sattigi **teklif (offer)**
   kaydidir: `(marketId, productId) -> priceMinor, isActive`. Ayni sut Migros'ta ve A101'de
   farkli fiyattadir.
4. **Sepet tek markettir.** Farkli marketlerin urunleri ayni sepete girmez; market
   degistirmek dolu sepeti bosaltmayi gerektirir (istemci onay ister).
5. **Fiyat kurallari marketten gelir.** `packages/pricing` kurallari PARAMETRE olarak alir,
   sabit okumaz. Bugun kurallarin kaynagi seed'dir; bir market paneli geldiginde kaynak
   degisir, hesap kodu degismez.
6. **Kuponlar platformundur** (ILK10, KARGOBEDAVA): tum marketlerde gecerlidir.
7. **Market paneli kapsam disidir.** Marketlerin kendi urun/fiyat/kural girisi yapacagi
   yonetim ekrani bu projede yok; seed onun yerini tutar. Puanlar seed'de sabit
   degerlerdir; yorum ve degerlendirme sistemi kapsam disidir.
8. **Kimlik bicimi (T8.4 oncesi acik kalan karar burada kapanir):** katalog kimlikleri
   onekli ve okunabilirdir (`mkt_`, `prd_`, `cat_`, `ofr_` + kucuk harf/rakam/tire).
   @getir/contracts bu kimlikleri UUID olarak DEGIL bu bicimle dogrular; @getir/core'un
   onek + 32 hex ureticisi calisma aninda uretilen kimlikler (siparis, odeme, kullanici)
   icindir, seed'le gelen katalog kimlikleri icin degil.

## Gerekce

Ekran tasarimi urunun kendisidir; veri modeli ona uymazsa her ekranda gecici cozum
yazilir. Tam pazaryeri secildi cunku markete ozel fiyat olmadan "marketten markete degisen"
deneyim yalnizca minimum sepette kalir ve urun kartlarindaki fiyatlar yanlis olur.

Mevcut kodun buyuk kismi bu modele uyar: `listDarkStoresByDistance` (T4.2) zaten
"yakindaki marketler" sorgusudur, `products.darkStoreIds` (T4.1) zaten "bu market bu urunu
satiyor mu" bilgisidir ve teklif koleksiyonuna donusur, stok zaten market kapsamlidir.

Elenen alternatifler: dark store'da kalmak (tasarimla celisir), kademeli pazaryeri
(fiyat ortak kalir; urun kartlari yanlis fiyat gosterir, sonradan fiyati urunden ayirmak
katalog, stok ve siparis dogrulamasini ikinci kez degistirmek demek).

## Sonuclari

- Olumlu: veri modeli ekranlarla birebir; fiyat kurallari ilk gunden veri olarak tasinir,
  market paneli geldiginde yalnizca kaynak degisir.
- Olumsuz: katalog iki koleksiyon daha kazanir (`markets`, `offers`), sozlesmeler degisir
  (proto + Zod), Gun 4'e iki gorev eklenir (T4.7, T4.8). 20 gunluk plan sikisir; tampon
  gunler (T15.3, T19.3) bunu karsilar, kesme sirasi guncellendi.
- Geriye uyum: `ResolveDarkStore` ve `DarkStore` mesaji proto'da SILINMEZ (buf breaking);
  kullanimdan kaldirildi (deprecated) olarak isaretlenir. `Product.price` ayni sekilde
  deprecated olur, fiyatin yeni yeri `Offer`'dir.
- Kabul edilen borc: puanlar sabit; market paneli yok.

## Ilgili

ADR-05 (koleksiyon sahipligi: markets ve offers catalog'undur), ADR-09 (sozlesme once),
ADR-13 (sepet yalnizca tarayicida); roadmap "Is Modeli: Pazaryeri" bolumu; gorevler T4.3,
T4.7, T4.8.
