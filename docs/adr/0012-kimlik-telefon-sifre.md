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
