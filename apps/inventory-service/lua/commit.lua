-- Rezervasyonu ONAYLAR (T10.2 PR 2; ADR-01, ADR-18; roadmap "Yasam dongusu",
-- B3, B4): odeme onaylandi, ayrilan adet kalici dusecek. Sahiplik
-- resv:index'teki siparis uyesidir: onu silen (ZREM) cagri isi yapar, digerleri
-- cekilir. Odeme onayi, kullanici iptali ve supurucu ayni rezervasyonu yaris
-- halinde isleseler de rezervasyon tek yoldan sonuclanir.
--
-- Stok sayaclarina DOKUNULMAZ: adet rezervasyonda zaten dusulmustu. Kalici
-- dusum (eldeki adet) ve defter kaydi Mongo'dadir; servis onlari bu script'ten
-- SONRA tek transaction'da yazar.
--
-- Kayit SILINMEZ, sonuclandi diye isaretlenir (state): adetler Mongo yazilana
-- kadar Redis'te kalir. Servis yazinca izi siler; yazim yarida kalirsa tekrar
-- gelen ayni istek izi bulur ve tamamlar (release.lua ile ayni desen).
--
-- KEYS[1]  rezervasyon hash'i   resv:{market}:{orderId}
-- KEYS[2]  sure indeksi (zset)  resv:index:{market}
-- KEYS[3]  kullanici kilidi     resv:user:{userId}  (ayri slot, beyanli; YALNIZCA on
--                                okuma aktif bir kayit bulduysa verilir)
--
-- ARGV[1] orderId   ARGV[2] userId (on okumadan; bilinmiyorsa bos)   ARGV[3] gerekce
-- ARGV[4] simdi (ms)   ARGV[5] izin en uzun omru (ms)
--
-- Doner (ilk eleman durum):
--   {'committed', sku, adet, ...}                   onaylandi
--   {'settled', durum, gerekce, an, sku, adet, ...}  daha once sonuclanmis, iz duruyor
--   {'absent'}                                       aktif rezervasyon yok
--   {'orphaned'}                                     indekste vardi, kaydi yok: indeksten silindi
--   {'stale'}                                        on okuma eskimis (kullanici farkli)
-- 'committed' ve 'orphaned' disindaki her durumda HICBIR SEY YAZILMAZ.

local resvKey, indexKey, userKey = KEYS[1], KEYS[2], KEYS[3]
local orderId, userId, reason = ARGV[1], ARGV[2], ARGV[3]
local nowMs, settledTtlMs = tonumber(ARGV[4]), tonumber(ARGV[5])

-- Kaydin qty:{sku} alanlari, cevaba eklenmeye hazir: sku, adet, sku, adet...
local function appendQuantities(reply)
  local fields = redis.call('HGETALL', resvKey)
  for i = 1, #fields, 2 do
    if string.sub(fields[i], 1, 4) == 'qty:' then
      reply[#reply + 1] = string.sub(fields[i], 5)
      reply[#reply + 1] = fields[i + 1]
    end
  end
  return reply
end

-- 0. Daha once sonuclanmis: izi oldugu gibi dondur.
local state = redis.call('HGET', resvKey, 'state')
if state then
  return appendQuantities({
    'settled', state, redis.call('HGET', resvKey, 'reason'), redis.call('HGET', resvKey, 'settledAt'),
  })
end

-- 1. Sahiplik indekste: uye yoksa aktif rezervasyon yoktur.
if not redis.call('ZSCORE', indexKey, orderId) then
  return { 'absent' }
end

-- 2. Uye var ama kayit yok: adetler bilinmiyor; indeks temizlenir.
if redis.call('EXISTS', resvKey) == 0 then
  redis.call('ZREM', indexKey, orderId)
  return { 'orphaned' }
end

-- 3. On okuma hala gecerli mi: ayni kullanici (kilidi o bildirdi).
if redis.call('HGET', resvKey, 'userId') ~= userId then
  return { 'stale' }
end

-- 4. Sahipligi al; kullanici kilidi yalnizca BU siparisinse silinir.
redis.call('ZREM', indexKey, orderId)
if userKey and redis.call('GET', userKey) == orderId then
  redis.call('DEL', userKey)
end

-- 5. Iz: sonuclandi, gerekce, an. Servis Mongo'yu yazinca siler; yazamazsa en
-- fazla bu kadar yasar (ADR-18). Iz dururken reserve.lua ayni siparisi yeniden
-- acmaz (EXISTS).
redis.call('HSET', resvKey, 'state', 'committed', 'reason', reason, 'settledAt', nowMs)
redis.call('PEXPIRE', resvKey, settledTtlMs)
return appendQuantities({ 'committed' })
