-- Rezervasyonu UZATIR (T11.3; roadmap B21): odeme ya da 3DS denemesi kilit
-- dusmeden bitsin. Bitis ani ARGV[4] kadar ileri alinir; kayit (hash), sure
-- indeksi (zset) ve kullanici kilidi BIRLIKTE: indeks geride kalirsa supurucu
-- uzatilmis rezervasyonu birakir, kullanici kilidi geride kalirsa ayni
-- kullanici ikinci bir kilit acar (B22).
--
-- Uzatma hakki sinirlidir (ARGV[6]); sayac kaydin 'extended' alanindadir
-- (reserve.lua 0 yazar). Hak bitince sure DEGISMEZ: 'limit' doner.
--
-- Bitis ani gecmis rezervasyon UZATILMAZ ('due'): supurucu henuz birakmamis
-- olsa da kilit dusmustur; uzatmak onu diriltir ve odeme, supurucunun her an
-- birakabilecegi stokla alinmis olurdu.
--
-- KEYS[1]  rezervasyon hash'i   resv:{market}:{orderId}
-- KEYS[2]  sure indeksi (zset)  resv:index:{market}
-- KEYS[3]  kullanici kilidi     resv:user:{userId}  (ayri slot, beyanli; YALNIZCA on
--                                okuma aktif bir kayit bulduysa verilir)
--
-- ARGV[1] orderId   ARGV[2] userId (on okumadan; bilinmiyorsa bos)
-- ARGV[3] simdi (ms)   ARGV[4] eklenecek sure (ms)
-- ARGV[5] hash'in bitisten sonra kalma payi (ms; reserve.lua ile ayni)
-- ARGV[6] en cok uzatma sayisi
--
-- Doner (ilk eleman durum):
--   {'extended', yeniBitis, sayac, sku, adet, ...}  uzatildi; sayac bu uzatma dahil
--   {'limit', bitis, sayac}                         hak bitmis
--   {'settled'}                                     sonuclanmis (iz duruyor)
--   {'absent'}                                      indekste yok
--   {'orphaned'}                                    indekste var, kaydi yok
--   {'due'}                                         bitis ani gecmis
--   {'stale'}                                       on okuma eskimis (kullanici farkli)
-- 'extended' disindaki her durumda HICBIR SEY YAZILMAZ.

local resvKey, indexKey, userKey = KEYS[1], KEYS[2], KEYS[3]
local orderId, userId = ARGV[1], ARGV[2]
local nowMs, addMs = tonumber(ARGV[3]), tonumber(ARGV[4])
local holdMs, maxExtensions = tonumber(ARGV[5]), tonumber(ARGV[6])

-- 1. Aktif mi: sonuclanmamis, indekste, kaydi duruyor, bitis ani gelmemis.
if redis.call('HGET', resvKey, 'state') then
  return { 'settled' }
end
local score = redis.call('ZSCORE', indexKey, orderId)
if not score then
  return { 'absent' }
end
if redis.call('EXISTS', resvKey) == 0 then
  return { 'orphaned' }
end
local expiresAt = tonumber(score)
if expiresAt <= nowMs then
  return { 'due' }
end
if redis.call('HGET', resvKey, 'userId') ~= userId then
  return { 'stale' }
end

-- 2. Hak bitti mi.
local count = tonumber(redis.call('HGET', resvKey, 'extended')) or 0
if count >= maxExtensions then
  return { 'limit', expiresAt, count }
end

-- 3. Uc yer birlikte ileri: kayit (alan + omur), indeks (XX: yalnizca var olan
-- uye), kullanici kilidi (yalnizca BU siparisinse).
expiresAt = expiresAt + addMs
count = count + 1
redis.call('HSET', resvKey, 'expiresAt', expiresAt, 'extended', count)
redis.call('PEXPIRE', resvKey, expiresAt - nowMs + holdMs)
redis.call('ZADD', indexKey, 'XX', expiresAt, orderId)
if userKey and redis.call('GET', userKey) == orderId then
  redis.call('PEXPIRE', userKey, expiresAt - nowMs)
end

-- 4. Kalemler: servis stok defterine uzatma kaydi yazar.
local reply = { 'extended', expiresAt, count }
local fields = redis.call('HGETALL', resvKey)
for i = 1, #fields, 2 do
  if string.sub(fields[i], 1, 4) == 'qty:' then
    reply[#reply + 1] = string.sub(fields[i], 5)
    reply[#reply + 1] = fields[i + 1]
  end
end
return reply
