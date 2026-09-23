# Mimari Karar Kayitlari (ADR)

Bu klasor, projenin geri donusu pahali kararlarini ve bu kararlarin gerekcelerini tutar.
Her dosya tek bir karardir ve ayni kalibi izler: Baglam, Karar, Gerekce, Sonuclari,
Ilgili. Kayitlar degistirilmez; bir karar gecersiz kaldiginda mevcut dosyanin durumu
guncellenir ve yerini alan yeni bir ADR yazilir.

Yeni kayit eklerken sonraki bos numara kullanilir, dosya adi
`NNNN-kisa-ingilizce-olmayan-slug.md` bicimindedir ve asagidaki tabloya bir satir eklenir.

| No  | Karar                                                                     | Durum        | Ozet                                                                                                                                                               |
| --- | ------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | [Lua vs Redlock](0001-lua-vs-redlock.md)                                  | Kabul edildi | Sicak yoldaki stok dusumu tek Lua script'i ile atomik yapilir; Redlock yalnizca arka plan islerinin liderlik secimi icindir.                                       |
| 02  | [Rezervasyon suresi ve ZSET](0002-rezervasyon-suresi-zset.md)             | Kabul edildi | Rezervasyon bitimi keyspace notification'a guvenmez; gercek kaynak resv:index ZSET'idir, supurucu saniyede bir tarar.                                              |
| 03  | [Stok gercegi Mongo, sayac Redis](0003-stok-gercegi-mongo-sayac-redis.md) | Kabul edildi | Kalici gercek Mongo'da (stock + stock_ledger), hizli sayac Redis'te; sayac acilista Mongo'dan seed edilir.                                                         |
| 04  | [Outbox ile olay yayini](0004-outbox-ile-olay-yayini.md)                  | Kabul edildi | Servisler arasi olaylar is kaydiyla ayni transaction'da outbox'a yazilir ve relay ile yayinlanir; bu yuzden Mongo replica set sarttir.                             |
| 05  | [Koleksiyon sahipligi](0005-koleksiyon-sahipligi.md)                      | Kabul edildi | Her servis kendi koleksiyonlarinin tek sahibidir; baska servisin koleksiyonuna erismek reddedilir, erisim gRPC ile olur.                                           |
| 06  | [Realtime ayri process](0006-realtime-ayri-process.md)                    | Kabul edildi | Realtime gateway'den ayri bir process'tir (Socket.io + Redis adapter); WebSocket yasam dongusu REST'ten farkli olceklenir.                                         |
| 07  | [EventBus arayuzu](0007-eventbus-arayuzu.md)                              | Kabul edildi | Olay hatti EventBus arayuzu arkasindadir; ilk uygulama Redis Streams, Kafka'ya gecis tek dosyadir.                                                                 |
| 08  | [Idempotency-Key](0008-idempotency-key.md)                                | Kabul edildi | Tum mutasyon uclari Idempotency-Key ister; anahtar once NX ile in-progress yazilir, cift tiklama ikinci siparis yaratmaz.                                          |
| 09  | [API-first ve MOCK modu](0009-api-first.md)                               | Kabul edildi | Sozlesme koddan once yazilir (proto + Zod); MOCK=1 modu frontend'i backend'i beklemekten kurtarir.                                                                 |
| 10  | [Tek dogrulama kutuphanesi](0010-zod-tek-dogrulama.md)                    | Kabul edildi | Calisma zamani dogrulamasi yalnizca Zod ile yapilir; TypeScript tipleri z.infer ile semadan turer.                                                                 |
| 11  | [Token ve sabitler](0011-token-ve-sabitler.md)                            | Kabul edildi | Gorsel degerler design token'da, is sabitleri config/constants.ts'te; sihirli sayi ve ondalikli para yasaktir.                                                     |
| 12  | [Telefon + sifre kimligi](0012-kimlik-telefon-sifre.md)                   | Kabul edildi | Kimlik dogrulama telefon + sifre (bcrypt, JWT + refresh); SMS/OTP kurulmaz, otp-velocity kurali ileriye birakilir.                                                 |
| 13  | [Sepet sadece tarayicida](0013-sepet-sadece-tarayicida.md)                | Kabul edildi | Sepet durumu sunucuda tutulmaz (Zustand + localStorage); sepetin sunucudaki karsiligi rezervasyondur.                                                              |
| 14  | [Frontend paralel gelistirme](0014-frontend-paralel-gelistirme.md)        | Kabul edildi | Frontend Gun 4'te MOCK=1 ile baslar, Gun 4-15 backend ile paralel ilerler, Gun 16-20 yalnizca tasarim ve cila icindir.                                             |
| 15  | [Pazaryeri modeli](0015-pazaryeri-modeli.md)                              | Kabul edildi | Kullanici marketi secer; urun ortak, fiyat markete ozel (offers); fiyat kurallari marketten gelir; market paneli kapsam disi. Dark store varsayiminin yerini alir. |
