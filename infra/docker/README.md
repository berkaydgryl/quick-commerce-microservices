# Gelistirme Altyapisi (Docker)

Bu klasor, yerel gelistirme icin gereken **durum tutan** servisleri ayaga kaldirir:

| Servis  | Konteyner     | Port    | Notu                                                                       |
| ------- | ------------- | ------- | -------------------------------------------------------------------------- |
| MongoDB | `getir-mongo` | `27017` | Tek dugumlu replica set `rs0` (transaction), servis basina kullanici (D14) |
| Redis   | `getir-redis` | `6379`  | Stok sayaclari + rezervasyon indeksi                                       |

Uygulama servisleri (`apps/*`) konteynerde **degil**, host uzerinde `pnpm dev` ile
calisir. Bu yuzden baglanti adresleri `localhost` uzerindendir.

---

## 1. Onkosullar

- Docker Desktop calisir durumda (WSL2 arka ucu onerilir)
- `27017` ve `6379` portlari bos
- Kokte `.env` var (`.env.example`'dan kopyalanir): Mongo kullanicilari oradan
  okunur (bkz. [Bolum 2a](#2a-mongo-kullanicilari-d14))

Portlari kontrol edin (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 27017, 6379 -State Listen -ErrorAction SilentlyContinue
```

Bos ise cikti uretmez.

---

## 2. Ayaga kaldirma

Repo kokunden (PowerShell veya cmd):

```powershell
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

Ilk calistirmada imajlar indirilir ve Mongo icin `rs0` replica set'i
**kendiliginden** baslatilir (bkz. [Bolum 4](#4-replica-set-dogrulama)).

Durdurma (veriler korunur):

```powershell
docker compose -f infra/docker/docker-compose.dev.yml stop
```

### 2a. Mongo kullanicilari (D14)

Her servisin **kendi veritabani** ve **kendi kullanicisi** vardir (ADR-05). Kullanici
yalnizca kendi veritabaninda okur ve yazar (`readWrite`); baska servisin
koleksiyonuna erisim Mongo tarafindan reddedilir (`not authorized`).

| Servis    | Veritabani        | Adres degiskeni       |
| --------- | ----------------- | --------------------- |
| catalog   | `getir_catalog`   | `CATALOG_MONGO_URI`   |
| inventory | `getir_inventory` | `INVENTORY_MONGO_URI` |
| order     | `getir_order`     | `ORDER_MONGO_URI`     |
| payment   | `getir_payment`   | `PAYMENT_MONGO_URI`   |
| risk      | `getir_risk`      | `RISK_MONGO_URI`      |
| gateway   | `getir_gateway`   | `GATEWAY_MONGO_URI`   |

- Kullanicilar kok `.env`'den gelir (compose `env_file`): kok kullanici
  `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD`, servis kullanicilari
  `<SERVIS>_MONGO_URI` adresindeki `kullanici:parola` ve `<SERVIS>_MONGO_DB`.
  Tanim tek yerde durur; servisin baglandigi adresle olusturulan kullanici ayrismaz.
- Servis kullanicilarini **ilk acilista** (bos hacim) `mongo/init/service-users.js`
  olusturur. Tanim eksikse hicbiri olusturulmaz ve konteyner gunlugu hangi degiskenin
  eksik oldugunu yazar.
- Kok kullanici yalnizca replica set kurulumu, saglik yoklamasi ve elle yonetim icindir;
  servisler onunla baglanmaz. Elle `mongosh` (kok kullaniciyla):

  ```bash
  pnpm infra:mongosh
  ```

- **Parola ya da kullanici degisirse:** ilk acilistan sonra `.env` degisirse Mongo'daki
  kullanicilar eski kalir. Ya hacmi sifirlayin (Bolum 6b; veri gider, `pnpm seed`
  tekrar) ya da `pnpm infra:mongosh` ile `db.getSiblingDB('admin').changeUserPassword(...)`.
- Replica set kimlik dogrulamayla calisirken uyeler birbirini anahtar dosyasiyla
  (`keyFile`) tanir. `mongo/entrypoint.sh` onu her acilista uretir; tek dugum oldugu
  icin saklamaya gerek yoktur.
- D14 oncesi kimlik dogrulamasiz hacim (`getir-mongo-data`) **silinmez**, yalnizca
  artik kullanilmaz. Gerekmiyorsa: `docker volume rm getir-mongo-data`.

---

## 3. Saglik kontrolu

Her iki konteyner de `healthy` olana kadar bekleyin:

```powershell
docker compose -f infra/docker/docker-compose.dev.yml ps
```

Beklenen cikti (STATUS sutunu):

```
NAME          STATUS
getir-mongo   Up 25 seconds (healthy)
getir-redis   Up 25 seconds (healthy)
```

Tek satirda durum sorgulama:

```powershell
docker inspect --format "{{.Name}} {{.State.Health.Status}}" getir-mongo getir-redis
```

Redis'i dogrudan yoklama:

```powershell
docker exec getir-redis redis-cli ping
```

`PONG` donmelidir. Kritik ayarlarin yuklendigini dogrulayin:

```powershell
docker exec getir-redis redis-cli config get maxmemory-policy
docker exec getir-redis redis-cli config get appendonly
docker exec getir-redis redis-cli config get notify-keyspace-events
```

Sirasiyla `noeviction`, `yes` ve **bos deger** donmelidir. `notify-keyspace-events`
bos degilse ADR-02 ihlal edilmis demektir (rezervasyon bitimi keyspace
notification'a guvenmez; gercek kaynak `resv:index` ZSET'i ve supurucudur).

---

## 4. Replica set dogrulama

`rs0` replica set'i, Mongo konteynerinin healthcheck komutu tarafindan ilk
acilista otomatik baslatilir. Ayrica elle `rs.initiate()` calistirmaniza gerek
**yoktur**.

Kimlik dogrulama acik oldugu icin komutlar kok kullaniciyla calisir; parola
konteynerin kendi ortamindan okunur (tek tirnak: degiskenleri host degil
konteyner acar). Durumu dogrulayin:

```bash
docker exec getir-mongo bash -c 'mongosh --quiet -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --eval "rs.status().ok"'
```

`1` donmelidir.

Uye adresini dogrulayin (kritik):

```bash
docker exec getir-mongo bash -c 'mongosh --quiet -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --eval "rs.status().members[0].name"'
```

Cikti **`localhost:27017`** olmalidir. Bu bilincli bir karardir: Node servisleri
host'ta calistigi icin uye adresi `mongo:27017` (konteyner adi) olsaydi, surucu
topolojiyi kesfedip bu ada baglanmaya calisir ve host'tan cozulemedigi icin
transaction'lar basarisiz olurdu.

Host'tan baglanti dizesi bu nedenle **her zaman** su bicimdedir (servisin kendi
kullanicisiyla; kullanicilar `admin` veritabaninda tanimli):

```
mongodb://<kullanici>:<parola>@localhost:27017/?directConnection=true&authSource=admin
```

> `directConnection=true` ile `replicaSet=rs0` ayni URI'de **birlikte
> kullanilamaz**. URI'de yalnizca `directConnection=true` bulunur.

Transaction'in gercekten calistigini dogrulamak icin:

```bash
docker exec getir-mongo bash -c 'mongosh --quiet -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --eval "const s=db.getMongo().startSession(); s.startTransaction(); s.getDatabase(\"getir_healthcheck\").probe.insertOne({ok:1}); s.commitTransaction(); print(\"transaction ok\")"'
```

---

## 5. Gunlukler

```powershell
docker compose -f infra/docker/docker-compose.dev.yml logs -f mongo
docker compose -f infra/docker/docker-compose.dev.yml logs -f redis
```

Son 100 satir:

```powershell
docker compose -f infra/docker/docker-compose.dev.yml logs --tail 100
```

---

## 6. Sifirlama

### 6a. Yalnizca veriyi temizle (konteynerler kalsin)

Redis'in mevcut veritabanini bosaltir:

```powershell
docker exec getir-redis redis-cli flushall
```

Mongo'daki servis veritabanlarini dusurur (kullanicilar kalir; ardindan `pnpm seed`):

```bash
docker exec getir-mongo bash -c 'mongosh --quiet -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --eval "[\"catalog\",\"inventory\",\"order\",\"payment\",\"risk\",\"gateway\"].forEach((s) => db.getSiblingDB(\"getir_\" + s).dropDatabase())"'
```

### 6b. Tam sifirlama (volume'ler dahil)

Konteynerleri, agi **ve adlandirilmis volume'leri** siler. Mongo replica set'i
bir sonraki `up` komutunda yeniden kurulur:

```powershell
docker compose -f infra/docker/docker-compose.dev.yml down -v
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

> `-v` bayragi `getir-mongo-auth-data` ve `getir-redis-data` volume'lerini siler.
> Tum yerel siparis/stok verisi ve Mongo kullanicilari kaybolur; `up` kullanicilari
> `.env`'den yeniden olusturur. Ardindan `pnpm seed` ve `pnpm seed:personas` calistirin.

Volume'lerin gittigini dogrulayin:

```powershell
docker volume ls --filter name=getir-
```

---

## 7. Sik karsilasilan sorunlar

| Belirti                                                      | Sebep / Cozum                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `getir-mongo` surekli `starting` durumunda                   | Healthcheck henuz `rs.initiate` calistirmadi. `start_period` 10s + 20 deneme; ~2 dk sonra hala ise gunluklere bakin.                     |
| `Transaction numbers are only allowed on a replica set`      | Replica set baslatilmamis. Bolum 4'teki `rs.status().ok` kontrolunu yapin, gerekirse 6b ile tam sifirlayin.                              |
| `MongoServerSelectionError: getaddrinfo ENOTFOUND mongo`     | URI'de konteyner adi kullanilmis. `<SERVIS>_MONGO_URI` degerinin `localhost:27017` + `directConnection=true` oldugundan emin olun.       |
| Servis acilmiyor: `Mongo kimlik dogrulamasi reddedildi`      | `.env`'deki `<SERVIS>_MONGO_URI` kullanici/parolasi ilk acilistakiyle ayni degil. Bolum 2a: hacmi sifirlayin ya da parolayi guncelleyin. |
| `Veritabani yetkisi yok` (gunlukte `not authorized on ...`)  | Servis baska bir veritabanina erismeye calisti (ADR-05) ya da `<SERVIS>_MONGO_DB` kullanicinin yetkili oldugu ad degil.                  |
| `getir-mongo` acilmiyor: `MONGO_ROOT_USERNAME yok`           | Kokte `.env` yok ya da D14 oncesinden kalma. `.env.example`'a gore guncelleyin, sonra `pnpm infra:up`.                                   |
| Mongo gunlugunde `<SERVIS>_MONGO_URI yok` (ilk acilis)       | `.env` eksikti; servis kullanicilari olusturulmadi. `.env`'i duzeltin, Bolum 6b ile hacmi sifirlayip yeniden acin.                       |
| `bind: address already in use`                               | Port dolu. Bolum 1'deki port kontrolunu yapin; yerel kurulu Mongo/Redis servisini durdurun.                                              |
| Redis `OOM command not allowed when used memory > maxmemory` | Beklenen davranis: politika `noeviction`. Stok sayaclari tahliye edilemez; bellegi buyutun veya veriyi temizleyin.                       |
