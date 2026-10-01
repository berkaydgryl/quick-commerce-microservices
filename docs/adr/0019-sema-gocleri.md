# ADR-19: Sema gocleri servisin acilisinda, kilit altinda ve servisin kendi veritabaninda kosar

- Durum: Kabul edildi
- Tarih: 2026-10-01

## Baglam

Proje kurali "sema degisikligi elle yapilmaz; versiyonlanmis ve geri alinabilir
migration ile yapilir" diyordu (kurallar denetimi #3, 22.09) ama calistiricisi yoktu.
Sonucu: T9.4 arama terimlerinin bicimini degistirdi ve eski veriyi duzeltmenin tek
yolu "pnpm seed calistirin" uyarisiydi (seed butun katalogu bastan yazar).

Servisler birden fazla ornekle calisabilir (stok servisi T10.3'ten beri). Ayni anda
acilan iki ornek ayni gocu iki kez calistirmamali. D14'ten beri her servisin kendi
veritabani ve kendi kullanicisi var (ADR-05 eki); gocun kaydi da oraya aittir.

## Karar

- Calistirici tek yerde, mongo-kit'te (`createMigrationRunner`, `applyMigrations`,
  `migrateMain`). Gocler sahibi servisin kodunda: `apps/<servis>/src/migrations/`,
  `000N-kisa-ad.ts` dosyalari ve acik bir kayit listesi (`index.ts`). `src` altindadir:
  D12'den beri imaja yalnizca derlenmis `dist` girer, gocler de derlenip imaja girer.
- Uygulananlar servisin kendi veritabaninda `migrations` koleksiyonundadir. Kaydin
  `_id`'si surumdur: ayni goc iki kez kaydedilemez.
- **Servis acilista bekleyen gocleri uygular**, indekslerden ONCE (kod uygulanmamis
  semayla calismaz). Bekleyen yoksa kilit alinmaz. Varsa kilit (`migrations_lock`,
  tek belge, sahip + bitis ani) alinir; ikinci ornek bekler, sonra kayitlari yeniden
  okuyup hepsini uygulanmis bulur. Coken calistirmanin kilidi omru dolunca (10 dk)
  devralinir; calisan sahip her goc oncesi omru yeniler, yenileyemezse durur.
- Varsayilan olarak goc ve kaydi TEK transaction'dadir (ya ikisi ya hicbiri). Transaction'da
  yapilamayan is (koleksiyon dusurme...) icin goc `transaction: false` der ve yeniden
  calistirilabilir yazilir.
- Tutarsizlik calismayi durdurur: kayitta olup kodda olmayan surum (kod geri alinmis),
  ayni surum farkli adla, en yeni uygulanmistan kucuk bekleyen surum (sira bozuk).
- Elle: servis bazinda `pnpm --filter @getir/<servis> migrate up | down | status`; kokten
  `pnpm migrate up | status`. `down` yalnizca en son TEK gocu geri alir ve kokten
  calismaz (butun servislerde birden geri alma kazayla veri kaybettirir).
- Goc o gunun mantiginin donmus kopyasini tasir (domain koduna, koleksiyon sabitine
  baglanmaz); uygulanmis goc degistirilmez, duzeltme yeni goctur.
- Indeksler goc degildir: bildirimli kalir (`MongoRepository.indexes()`).

## Gerekce

- Acilista uygulama, dagitimda ayri bir adimi unutma riskini kaldirir ve roadmap'in
  bitti tanimini karsilar ("iki ornek ayni anda baslatilinca goc bir kez kosar").
  Yalnizca elle calistirip acilista uyarmak (c) yeni kodu eski semayla actirirdi;
  acilisi durdurmak (b) her cekiste elle adim isterdi.
- Kilit Mongo'da: calistirici yalnizca Mongo'ya bagli kalir; Redis kullanmayan servis
  (catalog, risk) de goc calistirir. Kayit `_id`'si surum oldugu icin kilit bir sebeple
  asilsa bile transaction'li goc iki kez uygulanamaz (ikinci kayit benzersizlikten doner,
  transaction geri alinir).
- Transaction varsayilani yarim kalmis gocu imkansiz kilar; istisna acikca isaretlenir.
- Sira numarasi (zaman damgasi degil): tek gelistiricide cakisma yok, okunurlugu yuksek;
  cakisirsa sira bozuk denetimi yakalar.

## Sonuclari

- Olumlu: sema degisikligi kodla birlikte gelir ve her ortamda kendiliginden uygulanir;
  geri alma tek komut; eski veri icin "seed calistirin" uyarisi gerekmez.
- Olumsuz: transaction'li goc Mongo'nun transaction sinirlarina (60 sn, belge boyutu)
  tabidir; buyuk veri gocu `transaction: false` ve parcali, yeniden calistirilabilir
  yazilmalidir. Acilis, goc suresi kadar uzar.
- Kapsam disi: gateway (Go) bu calistiriciyi kullanmaz; gateway'in koleksiyonlarina goc
  gerekirse ayri karar.

## Ilgili

ADR-05 (ve D14 eki), ADR-04; gorev T10.4; proje kurallari "Veritabani".
