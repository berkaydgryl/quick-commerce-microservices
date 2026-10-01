-- Rezervasyonu BIRAKIR ve adetleri sayaclara geri ekler (T10.2; ADR-01, ADR-18;
-- roadmap "Yasam dongusu", B3, B4). Supurucu da ayni yolu "sure dolumu" kipinde
-- kullanir (T10.3, ADR-02): o kipte rezervasyon yalnizca bitis ani GECMISSE
-- birakilir (uzatilmis rezervasyona dokunulmaz) ve iz "expired" olur.
--
-- Sahiplik resv:index'teki siparis uyesidir: onu silen (ZREM) cagri isi yapar,
-- digerleri cekilir. Kullanici iptali, odeme onayi ve supurucu ayni
-- rezervasyonu yaris halinde isleseler de stok tam BIR KEZ hareket eder.
--
-- Kayit SILINMEZ, sonuclandi diye isaretlenir (state): adetler stok defteri
-- (Mongo) yazilana kadar Redis'te kalir. Servis defteri yazinca izi siler;
-- yazim yarida kalirsa tekrar gelen ayni istek izi bulur ve kaydi tamamlar.
--
-- KEYS[1]        rezervasyon hash'i   resv:{market}:{orderId}
-- KEYS[2]        sure indeksi (zset)  resv:index:{market}
-- KEYS[3..2+n]   stok sayaclari       stock:{market}:avail:{sku}
-- KEYS[3+n]      kullanici kilidi     resv:user:{userId}  (ayri slot, beyanli; YALNIZCA
--                                      on okuma aktif bir kayit bulduysa verilir)
--
-- Butun anahtarlar KEYS'te bildirilir (Redis Cluster kurali): servis once
-- hash'i okur (HGETALL) ve kullaniciyi, kalemleri oradan bilir. Okuma ile bu
-- script arasinda kayit degismis olabilir; script her seyi YENIDEN denetler.
--
-- ARGV[1] orderId   ARGV[2] userId (on okumadan; bilinmiyorsa bos)   ARGV[3] gerekce
-- ARGV[4] simdi (ms)   ARGV[5] izin en uzun omru (ms)
-- ARGV[6] kip: 'release' (Release RPC) ya da 'expire' (supurucu)
-- ARGV[7 .. 6+n] sku'lar (KEYS[3..] sirasinda)
--
-- Doner (ilk eleman durum):
--   {'released', atlanan, adet1 .. adetn}      birakildi; atlanan = sayaci olmayan kalem sayisi
--   {'settled', durum, gerekce, an, sku, adet, ...}  daha once sonuclanmis, iz duruyor
--   {'absent'}                                  aktif rezervasyon yok
--   {'not-due'}                                 'expire' kipinde bitis ani henuz gelmemis
--   {'orphaned'}                                indekste vardi, kaydi yok: indeksten silindi
--   {'stale'}                                   on okuma eskimis (kalemler ya da kullanici farkli)
--   {'corrupt', i}                              i. kalemin sayaci tam sayi degil
-- 'released' ve 'orphaned' disindaki her durumda HICBIR SEY YAZILMAZ.

local n = #ARGV - 6
local resvKey, indexKey, userKey = KEYS[1], KEYS[2], KEYS[3 + n]
local orderId, userId, reason = ARGV[1], ARGV[2], ARGV[3]
local nowMs, settledTtlMs, mode = tonumber(ARGV[4]), tonumber(ARGV[5]), ARGV[6]

-- Kaydin qty:{sku} alanlari: { sku = adet } ve alan sayisi.
local function heldQuantities()
  local fields = redis.call('HGETALL', resvKey)
  local held, count = {}, 0
  for i = 1, #fields, 2 do
    if string.sub(fields[i], 1, 4) == 'qty:' then
      held[string.sub(fields[i], 5)] = fields[i + 1]
      count = count + 1
    end
  end
  return held, count
end

-- 0. Daha once sonuclanmis: izi oldugu gibi dondur.
local state = redis.call('HGET', resvKey, 'state')
if state then
  local reply = {
    'settled', state, redis.call('HGET', resvKey, 'reason'), redis.call('HGET', resvKey, 'settledAt'),
  }
  local held = heldQuantities()
  for sku, quantity in pairs(held) do
    reply[#reply + 1] = sku
    reply[#reply + 1] = quantity
  end
  return reply
end

-- 1. Sahiplik indekste: uye yoksa aktif rezervasyon yoktur. Sure dolumu
-- kipinde bitis ani (skor) gelmemisse dokunulmaz: supurucu listeyi okuduktan
-- sonra rezervasyon uzatilmis olabilir.
local score = redis.call('ZSCORE', indexKey, orderId)
if not score then
  return { 'absent' }
end
if mode == 'expire' and tonumber(score) > nowMs then
  return { 'not-due' }
end

-- 2. Uye var ama kayit yok: adetler bilinmiyor, stok geri verilemez. Indeks
-- temizlenir ki supurucu (T10.3) ayni bos uyeyi her tick'te bulmasin.
if redis.call('EXISTS', resvKey) == 0 then
  redis.call('ZREM', indexKey, orderId)
  return { 'orphaned' }
end

-- 3. On okuma hala gecerli mi: ayni kullanici, ayni kalemler.
local held, count = heldQuantities()
if count ~= n or redis.call('HGET', resvKey, 'userId') ~= userId then
  return { 'stale' }
end
for i = 1, n do
  if held[ARGV[6 + i]] == nil then
    return { 'stale' }
  end
end

-- 4. Hepsini denetle, hicbir sey yazma: tam sayi olmayan sayacta INCRBY yarida
-- hata verir ve onceki artislar GERI ALINMAZ (reserve.lua ile ayni kural).
for i = 1, n do
  local raw = redis.call('GET', KEYS[2 + i])
  if raw and (not string.match(raw, '^%-?%d+$') or #raw > 18) then
    return { 'corrupt', i }
  end
end

-- 5. Sahipligi al, adetleri geri ekle. Sayaci OLMAYAN kalem atlanir: sayac
-- burada yaratilsaydi yalnizca bu adetle baslardi. Eksik sayaci eldeki
-- adetten yazmak sayac kurtarmasinin isidir (ADR-17, SET NX); birakilan adet
-- zaten onHand'in icindedir.
redis.call('ZREM', indexKey, orderId)
local reply = { 'released', 0 }
for i = 1, n do
  local quantity = held[ARGV[6 + i]]
  if redis.call('EXISTS', KEYS[2 + i]) == 1 then
    redis.call('INCRBY', KEYS[2 + i], quantity)
  else
    reply[2] = reply[2] + 1
  end
  reply[#reply + 1] = quantity
end

-- 6. Kullanici kilidi yalnizca BU siparisinse silinir.
if userKey and redis.call('GET', userKey) == orderId then
  redis.call('DEL', userKey)
end

-- 7. Iz: sonuclandi, gerekce, an. Servis defteri yazinca siler; yazamazsa en
-- fazla bu kadar yasar (ADR-18). Iz dururken reserve.lua ayni siparisi yeniden
-- acmaz (EXISTS).
local settled = 'released'
if mode == 'expire' then
  settled = 'expired'
end
redis.call('HSET', resvKey, 'state', settled, 'reason', reason, 'settledAt', nowMs)
redis.call('PEXPIRE', resvKey, settledTtlMs)
return reply
