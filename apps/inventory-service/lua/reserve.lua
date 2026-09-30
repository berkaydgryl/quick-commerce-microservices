-- Sepetin tamamini TEK atomik adimda rezerve eder (T10.1; ADR-01; roadmap
-- "Rezervasyon: tek atomik Lua script'i", B15, B22, B23). Redis script'i tek
-- is parcaciginda calistirdigi icin kontrol ile dusum arasina baska istek
-- giremez: ya sepetin tamami rezerve edilir ya hicbiri.
--
-- KEYS[1..n]  stok sayaclari       stock:{market}:avail:{sku}  (B15)
-- KEYS[n+1]   rezervasyon hash'i   resv:{market}:{orderId}
-- KEYS[n+2]   sure indeksi (zset)  resv:index:{market}
-- KEYS[n+3]   kullanici kilidi     resv:user:{userId}          (B22; ayri slot, bkz. redis-kit keys.ts)
--
-- ARGV[1] orderId   ARGV[2] userId   ARGV[3] marketId
-- ARGV[4] sure (ms) ARGV[5] simdi (ms, servisin saati)
-- ARGV[6] hash'in sure dolduktan sonra kalma payi (ms; supurucu icin)
-- ARGV[7 .. 6+n]     sku'lar (KEYS sirasinda; alan adi qty:{sku}, B23)
-- ARGV[7+n .. 6+2n]  adetler (servis dogrular: tam sayi, 1..99, sku'lar tekil)
--
-- Doner (ilk eleman durum):
--   {'reserved', bitis}         rezerve edildi
--   {'already', bitis}          bu siparis zaten rezerve; sayaclara DOKUNULMADI (ADR-08)
--   {'user-active', siparis}    kullanicinin baska aktif rezervasyonu var (B22)
--   {'insufficient', i, sayac}  i. kalem yetmiyor
--   {'missing', i}              i. kalemin sayaci yok (bu markette satilmiyor ya da Redis bosaldi)
--   {'corrupt', i}              i. kalemin sayaci tam sayi degil
-- 'reserved' ve 'already' disindaki her durumda HICBIR SEY YAZILMAZ.

local n = #KEYS - 3
local resvKey, indexKey, userKey = KEYS[n + 1], KEYS[n + 2], KEYS[n + 3]
local orderId, userId, marketId = ARGV[1], ARGV[2], ARGV[3]
local ttlMs, nowMs, holdMs = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])

-- 0. Ayni siparis ikinci kez gelirse sayaclar tekrar dusmez.
if redis.call('EXISTS', resvKey) == 1 then
  return { 'already', redis.call('HGET', resvKey, 'expiresAt') }
end

-- 1. Kullanicinin baska aktif rezervasyonu varsa yenisi acilmaz.
local active = redis.call('GET', userKey)
if active and active ~= orderId then
  return { 'user-active', active }
end

-- 2. Hepsini kontrol et, hicbir sey yazma. Sayac tam sayi olmali: DECRBY
-- yarida hata verirse Redis onceki dusumleri GERI ALMAZ (kismi rezervasyon).
for i = 1, n do
  local raw = redis.call('GET', KEYS[i])
  if not raw then
    return { 'missing', i }
  end
  if not string.match(raw, '^%-?%d+$') or #raw > 18 then
    return { 'corrupt', i }
  end
  local have = tonumber(raw)
  if have < tonumber(ARGV[6 + n + i]) then
    return { 'insufficient', i, have }
  end
end

-- 3. Hepsini birden dus; adetleri rezervasyona yaz (birakma ve onay icin sart).
local expiresAt = nowMs + ttlMs
for i = 1, n do
  local quantity = ARGV[6 + n + i]
  redis.call('DECRBY', KEYS[i], quantity)
  redis.call('HSET', resvKey, 'qty:' .. ARGV[6 + i], quantity)
end

-- 4. Kimlik, sure, indeks ve kullanici kilidi.
redis.call('HSET', resvKey, 'orderId', orderId, 'userId', userId, 'marketId', marketId,
  'reservedAt', nowMs, 'expiresAt', expiresAt, 'extended', 0)
redis.call('PEXPIRE', resvKey, ttlMs + holdMs)
redis.call('ZADD', indexKey, expiresAt, orderId)
redis.call('SET', userKey, orderId, 'PX', ttlMs)
return { 'reserved', expiresAt }
