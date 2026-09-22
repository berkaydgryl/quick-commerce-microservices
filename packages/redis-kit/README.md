# @getir/redis-kit

Redis'e bakan üç şey burada: **bağlantı**, **anahtar üreticileri** ve **Lua script
yükleyici**. İş mantığı yok — rezervasyon kuralları `inventory-service` içindedir; bu
paket yalnızca "hangi anahtar, hangi bağlantı, script nasıl yüklenir" sorularını
cevaplar.

## Neden anahtarlar tek yerde

Bir anahtarı yazan (inventory), okuyan (gateway) ve süpüren (sweeper) taraf farklı
servislerdir. Biçim elle yazılsaydı üç yerde üç ufak fark oluşur ve stok "kaybolurdu".
Tek doğru kaynak `src/keys.ts`.

| Üretici                            | Anahtar                           | Tip    |
| ---------------------------------- | --------------------------------- | ------ |
| `stockAvailKey(store, sku)`        | `stock:{ds_kadikoy}:avail:SUT-1L` | string |
| `reservationKey(store, orderId)`   | `resv:{ds_kadikoy}:ord_1`         | hash   |
| `reservationIndexKey(store)`       | `resv:index:{ds_kadikoy}`         | zset   |
| `userReservationKey(userId)`       | `resv:user:{usr_7}`               | string |
| `courierTrackKey / courierLastKey` | `courier:{crr_2}:track`           | list   |
| `idempotencyKey(key)`              | `idem:{4f1c...}`                  | string |
| `rateLimitKey(ip, route)`          | `rate:{10.0.0.1}:POST_/v1/orders` | string |
| `EVENTS_STREAM_KEY`                | `stream:events`                   | stream |
| `RECONCILE_LOCK_KEY`               | `lock:reconcile`                  | string |

### Hash-tag kuralı

Redis Cluster bir anahtarı slot'a atarken **yalnızca ilk süslü parantez çifti**
arasındaki metne bakar. Bir depoya ait tüm anahtarlar `{ds_kadikoy}` taşıdığı için aynı
slot'a düşer; rezervasyon Lua script'inin tek atomik adımda çalışabilmesinin şartı budur
(ADR-01).

Tablodaki `{sku}`, `{orderId}` gibi gösterimler **yer tutucudur**; gerçek anahtarda süslü
parantez yalnızca hash-tag olan parçada bulunur.

> **Bilinen sınır:** `resv:user:{userId}` hash-tag'i userId'dir, stok anahtarlarınınki
> storeId. `reserve.lua` ikisine birden dokunuyor (B22). Tek düğümlü Redis'te sorun değil;
> Cluster'a geçilirse `CROSSSLOT` hatası verir. Karar o gün verilecek — seçenek, kullanıcı
> anahtarını da store hash-tag'i altına almak, ama o zaman aynı kullanıcının **farklı
> depolardaki** ikinci rezervasyonu engellenemez. `test/unit/keys.spec.ts` bu gerçeği
> sabitler.

Anahtar parçaları doğrulanır: `:` ve `{}` ayırıcı olduğu için parçaların içinde
bulunamaz, geçersiz değer `AppError` (VALIDATION_FAILED) ile reddedilir.

## Lua yükleyici

Script'ler kaynakta `.lua` dosyası olarak durur, TypeScript içinde string olarak değil —
böylece sözdizimi vurgulanır ve `redis-cli --eval` ile elle denenebilir. İki modül: dosya
sistemini yalnızca `src/scripts/source.ts` bilir (`readLuaDirectory`), Redis'i yalnızca
`src/scripts/registry.ts` (`loadLuaScripts`).

```ts
const scripts = await loadLuaScripts(connection.redis, luaDir, logger);
const [ok, kalan] = (await scripts.get('reserve').run(keys, args)) as [number, number];
```

Açılışta her dosya `SCRIPT LOAD` ile yüklenir, çağrılar `EVALSHA` ile gider. Redis yeniden
başlar ya da `SCRIPT FLUSH` çalışırsa SHA kaybolur ve `NOSCRIPT` döner: yükleyici bunu
yakalar, script'i yeniden yükler ve çağrıyı bir kez daha dener. Servis bunu fark etmez,
yalnızca bir uyarı günlüğü kalır. (`test/integration` içinde `SCRIPT FLUSH` ile kanıtlanır.)

Script'in dokunduğu anahtarlar farklı hash-tag taşıyorsa **uyarı yazılır ama çağrı
engellenmez** — tek düğümde bu geçerli bir kullanım, Cluster'da değil.

## Bağlantı

```ts
const redis = await connectRedis({ url: env.REDIS_URL, logger, name: 'inventory' });
await redis.ping();
await redis.close(); // kuyruktaki komutlar bitsin diye quit, disconnect değil
```

`error` olayının dinleyicisi **her zaman** bağlanır: ioredis'te dinleyici yoksa Redis bir
an düştüğünde Node süreci yakalanmamış hatayla ölür.

İlk bağlantıda `connect()` sözü **beklenmez**, `ready` olayı bir süre bütçesi içinde
beklenir (varsayılan 5 sn, `REDIS_CONNECT_TIMEOUT_MS`). Sebebi: `connect()` ilk
`ECONNREFUSED`'da reddeder ama ioredis arkada `retryStrategy` ile denemeye devam eder.
Servis ile Redis aynı anda ayağa kalkıyorsa (compose, Testcontainers, k8s) ilk deneme
kaybedilir ve servis, Redis yarım saniye sonra hazır olacakken ölürdü.

## Test

Birim testleri anahtar biçimlerini ve doğrulamayı kapsar. Gerçek davranış
(atomiklik, `NOSCRIPT` toparlanması) `test/integration` içinde Testcontainers ile
doğrulanır: `pnpm test:int`.
