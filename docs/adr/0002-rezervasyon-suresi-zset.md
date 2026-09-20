# ADR-02: Rezervasyon bitimi keyspace notification'a degil ZSET taramasina baglanir

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Rezervasyon sureli bir haktir: RESERVATION_TTL_SECONDS=600, risk motoru orta risk
isaretlerse RESERVATION_TTL_MEDIUM_RISK_SECONDS=120. Sure dolunca dusulen stok geri
verilmelidir; aksi halde terk edilen sepetler depoyu yavas yavas satisa kapatir. En
kolay yol Redis anahtarina TTL koyup keyspace notification (expired olayi) dinlemektir.
Ancak bu olay en fazla bir kez teslim edilir: abone kopuksa veya henuz ayaga
kalkmadiysa olay tamamen kaybolur, Redis tembel silme nedeniyle olayi gecikmeli
uretebilir ve olayin govdesi rezervasyonun is verisini tasimaz.

## Karar

Rezervasyon yasam dongusunun tek gercek kaynagi resv:index ZSET'idir; score olarak
rezervasyonun bitis zamani (epoch ms) yazilir. Supurucu SWEEPER_INTERVAL_MS=1000
araligiyla suresi gecmis rezervasyonlari skor araligindan sinirli sayida ceker, her
birini ADR-01'deki Lua yolu uzerinden iade eder ve indeksten siler. Anahtar TTL'i
yalnizca ikincil cop toplama olarak birakilir; hicbir is kurali TTL'in tetikledigi
olaya bagli degildir. Keyspace notification KULLANILMAZ.

## Gerekce

Tarama kayipsizdir ve yeniden calistirilabilir: supurucu cokup geri geldiginde birikmis
tum sureleri ayni sorguyla yakalar, oysa kacirilmis bir notification'in telafisi yoktur.
Notification'i "hizlandirici", ZSET'i "emniyet agi" olarak birlikte kullanmak da elendi;
iki tetikleyici iki dogruluk kaynagi demektir ve ayni rezervasyonun iki kez iade edilmesi
riskini gereksiz yere ureten karmasiklik getirir. ZSET ayrica sorgulanabilirdir: en
yakin bitisin ne zaman oldugu ve kac aktif rezervasyon bulundugu bedavaya okunur.

## Sonuclari

- Olumlu: en az bir kez calisma, tekrar denenebilirlik, yeniden baslatmaya dayaniklilik;
  supurucunun gerilik metrigi (en eski gecikmis rezervasyonun yasi) dogrudan olculebilir.
- Olumsuz: iade en fazla bir tarama araligi kadar, yani 1 saniye gecikebilir; bu ust
  sinir kabul edilir. Bos dakikalarda bile saniyede bir sorgu calisir; sinirli skor
  araligi sorgusu ucuz oldugu icin bu maliyet onemsizdir.
- Kabul edilen borc: iade adimi idempotent olmak zorundadir, ACTIVE -> RELEASED gecisi
  Lua icinde karsilastir-ve-degistir olarak yapilir. Birden fazla supurucu kopyasi
  calisacaksa liderlik gerekir (ADR-01).

## Ilgili

ADR-01, ADR-03, ADR-11; gorev T1.5.
