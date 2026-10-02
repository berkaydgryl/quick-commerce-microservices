-- Rezervasyonun kalan suresini KISALTIR (T11.3; roadmap "Bantlar ve
-- aksiyonlar": orta risk bandinda kilit 2 dk). Kilit taslak acilirken uzun
-- sureyle alinir (T11.2), risk ise odeme adiminda sorulur: orta bantta order
-- kalan sureyi ARGV[4]'e indirir. Kalan sure zaten kisaysa dokunulmaz; bu
-- script ASLA uzatmaz.
--
-- Kayit (hash), sure indeksi (zset) ve kullanici kilidi BIRLIKTE kisalir:
-- supurucu kilidi yeni bitiste birakir, kullanici kilidi de onunla duser.
--
-- KEYS[1]  rezervasyon hash'i   resv:{market}:{orderId}
-- KEYS[2]  sure indeksi (zset)  resv:index:{market}
-- KEYS[3]  kullanici kilidi     resv:user:{userId}  (ayri slot, beyanli; YALNIZCA on
--                                okuma aktif bir kayit bulduysa verilir)
--
-- ARGV[1] orderId   ARGV[2] userId (on okumadan; bilinmiyorsa bos)
-- ARGV[3] simdi (ms)   ARGV[4] en cok kalan sure (ms)
-- ARGV[5] hash'in bitisten sonra kalma payi (ms; reserve.lua ile ayni)
--
-- Doner (ilk eleman durum):
--   {'shortened', yeniBitis}   kisaltildi
--   {'unchanged', bitis}       kalan sure zaten sinirin altinda
--   {'settled'} {'absent'} {'orphaned'} {'due'} {'stale'}  extend.lua ile ayni anlam
-- 'shortened' disindaki her durumda HICBIR SEY YAZILMAZ.

local resvKey, indexKey, userKey = KEYS[1], KEYS[2], KEYS[3]
local orderId, userId = ARGV[1], ARGV[2]
local nowMs, maxRemainingMs, holdMs = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])

-- 1. Aktif mi (extend.lua ile ayni denetim).
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

-- 2. Zaten kisa mi.
local cap = nowMs + maxRemainingMs
if expiresAt <= cap then
  return { 'unchanged', expiresAt }
end

-- 3. Uc yer birlikte geri: kayit, indeks (XX), kullanici kilidi (yalnizca BU siparisinse).
redis.call('HSET', resvKey, 'expiresAt', cap)
redis.call('PEXPIRE', resvKey, maxRemainingMs + holdMs)
redis.call('ZADD', indexKey, 'XX', cap, orderId)
if userKey and redis.call('GET', userKey) == orderId then
  redis.call('PEXPIRE', userKey, maxRemainingMs)
end
return { 'shortened', cap }
