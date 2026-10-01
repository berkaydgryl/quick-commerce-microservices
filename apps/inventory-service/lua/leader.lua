-- Supurucu liderlik kilidi (T10.3; roadmap B25, ADR-01: dagitik kilit yalnizca
-- burada). Tek Redis dugumunde Redlock'un tek ornekli hali: kilidi yalnizca
-- sahibi (belirteci tasiyan ornek) yeniler ya da birakir; kontrol ile yazim
-- ayni atomik adimdadir, araya baska ornek giremez.
--
-- KEYS[1] kilit (lock:reconcile)
-- ARGV[1] sahiplik belirteci (ornege ozgu)   ARGV[2] omur (ms)   ARGV[3] 'hold' | 'release'
--
-- Doner:
--   hold:    2 = kilit alindi, 1 = zaten bizdeydi ve yenilendi, 0 = baskasinda
--   release: 1 = birakildi, 0 = bizde degildi (dokunulmadi)

local lockKey, token, ttlMs, action = KEYS[1], ARGV[1], ARGV[2], ARGV[3]
local current = redis.call('GET', lockKey)

if action == 'release' then
  if current == token then
    redis.call('DEL', lockKey)
    return 1
  end
  return 0
end

if current == token then
  redis.call('PEXPIRE', lockKey, ttlMs)
  return 1
end
if not current then
  redis.call('SET', lockKey, token, 'PX', ttlMs)
  return 2
end
return 0
