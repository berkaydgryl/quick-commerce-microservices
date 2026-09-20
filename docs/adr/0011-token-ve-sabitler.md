# ADR-11: Gorsel degerler design token'da, is sabitleri config/constants.ts'te durur

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Iki farkli "sihirli sayi" turu var ve ikisi de ayni sekilde koda sizma egiliminde. Birincisi
gorsel degerler: renk, bosluk, yaricap, gecis suresi. Bunlar bilesenlerin icine tek tek
yazildiginda arayuz tutarsizlasir ve tema degisikligi elle arama-degistirme isine doner.
Ikincisi is degerleri: rezervasyon suresi, tarama araligi, kurye tik araligi ve hizi,
token omru. Bunlar cagri yerine gomuldugunde ayni kural iki dosyada farkli iki sayiya
donusur ve hangisinin dogru oldugu belirsizlesir.

## Karar

Gorsel degerler yalnizca design token olarak tanimlanir ve bilesenler token'a referans
verir; bilesen dosyasinda ciplak renk ya da piksel degeri bulunmaz. Is sabitleri
config/constants.ts icinde isimlendirilmis sabit olarak durur ve oradan ice aktarilir:
RESERVATION_TTL_SECONDS=600, RESERVATION_TTL_MEDIUM_RISK_SECONDS=120,
SWEEPER_INTERVAL_MS=1000, COURIER_TICK_MS=2000, COURIER_SPEED_KMH=20, JWT_TTL=3600.
Ortamdan gelmesi gereken degerler icin sabit, dogrulanmis varsayilan gorevi gorur
(ADR-10). Para birimi her yerde kurus cinsinden tam sayidir; ondalikli para degeri ve
ciplak sayisal esik kod incelemesinde reddedilir.

## Gerekce

Isimlendirilmis sabit yalnizca tekrari onlemez, degerin ne oldugunu anlatir: 120 sayisi
tek basina hicbir sey soylemezken RESERVATION_TTL_MEDIUM_RISK_SECONDS risk kuralini da
belgelemis olur. Token tarafinda ayni sey gorsel dil icin gecerlidir ve Gun 16-20'deki
tasarim calismasini tek dosyada yapilabilir kilar (ADR-14). Degerleri dogrudan
yapilandirma dosyalarina dagitmak alternatifi elendi: tip guvenligi ve tek yerden
okunabilirlik kaybolur.

## Sonuclari

- Olumlu: davranis ayarlamak tek satirlik ve gozden gecirilebilir bir degisiklik olur;
  tema degisikligi bilesenlere dokunmadan yapilir.
- Olumsuz: kucuk degerler icin bile bir isim uydurmak gerekir; sabit dosyasi buyudukce
  konuya gore bolunmek zorundadir.
- Kabul edilen borc: sabitlerin calisma zamaninda degistirilmesi (yeniden baslatmadan)
  desteklenmez.

## Ilgili

ADR-02, ADR-10, ADR-13, ADR-14; gorev T1.5.
