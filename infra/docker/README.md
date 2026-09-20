# Gelistirme Altyapisi (Docker)

Bu klasor, yerel gelistirme icin gereken **durum tutan** servisleri ayaga kaldirir:

| Servis  | Konteyner     | Port    | Notu                                        |
| ------- | ------------- | ------- | ------------------------------------------- |
| MongoDB | `getir-mongo` | `27017` | Tek dugumlu replica set `rs0` (transaction) |
| Redis   | `getir-redis` | `6379`  | Stok sayaclari + rezervasyon indeksi        |

Uygulama servisleri (`apps/*`) konteynerde **degil**, host uzerinde `pnpm dev` ile
calisir. Bu yuzden baglanti adresleri `localhost` uzerindendir.

---

## 1. Onkosullar

- Docker Desktop calisir durumda (WSL2 arka ucu onerilir)
- `27017` ve `6379` portlari bos

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

Durumu dogrulayin:

```powershell
docker exec getir-mongo mongosh --quiet --eval "rs.status().ok"
```

`1` donmelidir.

Uye adresini dogrulayin (kritik):

```powershell
docker exec getir-mongo mongosh --quiet --eval "rs.status().members[0].name"
```

Cikti **`localhost:27017`** olmalidir. Bu bilincli bir karardir: Node servisleri
host'ta calistigi icin uye adresi `mongo:27017` (konteyner adi) olsaydi, surucu
topolojiyi kesfedip bu ada baglanmaya calisir ve host'tan cozulemedigi icin
transaction'lar basarisiz olurdu.

Host'tan baglanti dizesi bu nedenle **her zaman** sudur:

```
mongodb://localhost:27017/getir?directConnection=true
```

> `directConnection=true` ile `replicaSet=rs0` ayni URI'de **birlikte
> kullanilamaz**. URI'de yalnizca `directConnection=true` bulunur.

Transaction'in gercekten calistigini dogrulamak icin:

```powershell
docker exec getir-mongo mongosh --quiet --eval "const s=db.getMongo().startSession(); s.startTransaction(); s.getDatabase('getir').healthcheck.insertOne({ok:1}); s.commitTransaction(); print('transaction ok')"
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

Mongo'daki uygulama veritabanini dusurur:

```powershell
docker exec getir-mongo mongosh --quiet --eval "db.getSiblingDB('getir').dropDatabase()"
```

### 6b. Tam sifirlama (volume'ler dahil)

Konteynerleri, agi **ve adlandirilmis volume'leri** siler. Mongo replica set'i
bir sonraki `up` komutunda yeniden kurulur:

```powershell
docker compose -f infra/docker/docker-compose.dev.yml down -v
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

> `-v` bayragi `getir-mongo-data` ve `getir-redis-data` volume'lerini siler.
> Tum yerel siparis/stok verisi kaybolur; ardindan `pnpm seed` calistirin.

Volume'lerin gittigini dogrulayin:

```powershell
docker volume ls --filter name=getir-
```

---

## 7. Sik karsilasilan sorunlar

| Belirti                                                      | Sebep / Cozum                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `getir-mongo` surekli `starting` durumunda                   | Healthcheck henuz `rs.initiate` calistirmadi. `start_period` 10s + 20 deneme; ~2 dk sonra hala ise gunluklere bakin.      |
| `Transaction numbers are only allowed on a replica set`      | Replica set baslatilmamis. Bolum 4'teki `rs.status().ok` kontrolunu yapin, gerekirse 6b ile tam sifirlayin.               |
| `MongoServerSelectionError: getaddrinfo ENOTFOUND mongo`     | URI'de konteyner adi kullanilmis. `MONGO_URI` degerinin `localhost:27017` + `directConnection=true` oldugundan emin olun. |
| `bind: address already in use`                               | Port dolu. Bolum 1'deki port kontrolunu yapin; yerel kurulu Mongo/Redis servisini durdurun.                               |
| Redis `OOM command not allowed when used memory > maxmemory` | Beklenen davranis: politika `noeviction`. Stok sayaclari tahliye edilemez; bellegi buyutun veya veriyi temizleyin.        |
