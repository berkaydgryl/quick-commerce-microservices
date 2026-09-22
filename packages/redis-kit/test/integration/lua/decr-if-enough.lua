-- Yeterliyse dusur: T10.1'deki reserve.lua'nin tek anahtarlik provasi.
--
-- KEYS[1] = stok sayaci (stock:{store}:avail:SKU)
-- ARGV[1] = istenen adet
--
-- Doner: {1, kalan} yeterliyse, {0, mevcut} degilse.
-- Onemli olan, KONTROL ile DUSUMUN arasina baska bir istegin girememesi.
local istenen = tonumber(ARGV[1])
local mevcut = tonumber(redis.call('GET', KEYS[1]) or 0)

if mevcut < istenen then
  return { 0, mevcut }
end

local kalan = redis.call('DECRBY', KEYS[1], istenen)
return { 1, kalan }
