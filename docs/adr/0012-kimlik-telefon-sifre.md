# ADR-12: Kimlik dogrulama telefon + sifre ile yapilir, SMS/OTP kurulmaz

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Hizli market uygulamalarinda kimlik genellikle telefon numarasi ve SMS ile gonderilen tek
kullanimlik koddur. Bu akis gercek bir SMS saglayicisi, ucret, numara dogrulama kuyrugu,
kod yeniden gonderme sayaci ve saglayici kesintisinde yedek yol gerektirir. Demoda bunun
karsiligi, tamami dis bir servise bagli ve gosterilemeyen bir is paketidir. Ote yandan
kimligin kendisi sistemin her yerinde gerekli: gateway, servisler ve realtime ayni
oturumu tanimak zorunda (ADR-06).

## Karar

Kimlik dogrulama telefon numarasi + sifre ile yapilir. Sifreler bcrypt ile saklanir; ham
sifre hicbir yerde loglanmaz. Basarili girisde kisa omurlu erisim token'i (JWT,
JWT_TTL=3600) ve uzun omurlu refresh token verilir; erisim token'i hem HTTP hem
WebSocket el sikismasinda ayni sekilde dogrulanir. SMS/OTP altyapisi bugun kurulmaz.
Risk motorunun otp-velocity kurali (kisa surede cok sayida kod talebi) tasarimda yerini
korur ama uygulamasi ileriye birakilir; risk motoru bugun diger sinyallerle calisir.

## Gerekce

Telefon + sifre, dis bagimliligi sifira indirir ve demo her yerde, cevrimdisi bile
calisir. Telefon numarasini kullanici anahtari olarak tutmak, ilerde OTP eklendiginde
sema degisikligi gerektirmez: eklenecek olan yalnizca ikinci bir dogrulama yontemidir.
Sahte OTP (ekranda gosterilen sabit kod) alternatifi elendi cunku hem guvenlik izlenimi
verir hem de gercek olmayan bir akis icin kod yazdirir.

## Sonuclari

- Olumlu: kimlik akisi uctan uca kendi kodumuzda, testi kolay ve deterministik; token
  dogrulama tek yerde tanimlanip her serviste yeniden kullanilir.
- Olumsuz: numaranin gercekten kullaniciya ait oldugu dogrulanmaz; bu, urun degil demo
  kararidir ve belgede acikca soylenir.
- Kabul edilen borc: refresh token dondurme ve iptal listesi sade tutulur; otp-velocity
  kurali kagit uzerinde kalir.

## Ilgili

ADR-06, ADR-08, ADR-09; gorev T1.5.

## Ek (T8.5 hazirligi, 2026-09-29): yenileme jetonu HttpOnly cerezde

Ustteki karar degismez; jetonun istemciye nasil tasindigini netlestirir. Web kimlik akisi (T8.5)
jetonlari tarayicida saklayacagi icin karar oncesinde verildi.

- Erisim jetonu (JWT, JWT_TTL) cevap govdesinde doner; istemci onu yalnizca bellekte tutar
  (localStorage'a yazilmaz).
- Yenileme jetonu govdede DONMEZ: gateway onu `getir_refresh` cerezine yazar. HttpOnly: sayfadaki
  betik okuyamaz, bir XSS 14 gunluk jetonu calamaz. `SameSite=Strict`: baska bir siteden gelen
  istek cerezi tasimaz (CSRF). `Path=/v1/auth`: jeton yalnizca kimlik uclarina gider. Omur
  REFRESH_TTL; production'da `Secure`.
- `POST /v1/auth/refresh` ve `/v1/auth/logout` govdesizdir; jeton cerezden okunur. Cerezsiz
  yenileme 401'dir; kullanilamayan jetonun cerezi ve cikista cerez silinir.
- Elenen: yenileme jetonunu localStorage'da tutmak (gateway degismezdi ama XSS'te jeton
  calinirdi) ve sessionStorage (sekme kapaninca oturum giderdi).
- Bedel: tarayici disi istemciler (curl, testler) cerez kavanozu kullanir; web ile gateway ayni
  site (gelistirmede Vite vekili) uzerinden calismalidir. Sozlesme degisti: oturum govdesinde
  `refreshToken` yok (`@getir/contracts` authSessionSchema, openapi AuthSession).
- Web istemcisi (T8.5 ikinci PR): erisim jetonu yalnizca sekmenin belleginde durur; sayfa
  yenilenince acilista bir kez sessiz yenileme oturumu geri getirir, herkese acik sayfa onu
  beklemez. 401 alan istek bir kez yenilenip bir kez tekrarlanir (`apps/web/src/shared/session`).
- Sekmeler arasi sira: jeton her kullanimda degistigi ve kullanilmis jetonun 401'i cerezi sildigi
  icin iki sekmenin ayni anda yenilemesi ikisinin de oturumunu dusururdu. Yenileme, giris, kayit
  ve cikis butun sekmelerde tek kilitle (Web Locks API, `getir-oturum`) sirayla calisir; ikinci
  sekme birincinin yazdigi YENI cerezi gonderir. Web Locks yoksa (guvensiz baglam) kilit sekme
  icindedir.
- Yenileme ve cikis genel hiz sinirindadir (IP basina dakikada 120, T8.2): web her acilista
  yeniler; jeton 256 bit rastgele oldugu icin kaba kuvvet siniri gerekmez. Kayit ve giris 10'da
  kalir.
