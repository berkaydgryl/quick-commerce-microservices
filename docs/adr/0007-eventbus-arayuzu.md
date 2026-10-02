# ADR-07: Olay hatti EventBus arayuzu arkasinda durur

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Sistemde gercek bir olay hattina ihtiyac var (ADR-04), ama demo icin Kafka ayaga
kaldirmak ayri bir operasyon yuku demek: broker, Zookeeper ya da KRaft ayarlari, sema
kayit defteri ve yavas acilis. Redis zaten var ve Redis Streams tuketici grubu, onay ve
yeniden teslim sunuyor. Risk, yayin ve tuketim cagrilarinin servis kodunun her yerine
yayilmasi ve ilerde Kafka'ya gecisin toplu bir yeniden yazim haline gelmesidir.

## Karar

Yayin ve tuketim @getir/event-bus paketindeki EventBus arayuzu arkasindadir. Servis kodu
yalnizca publish(envelope) ve subscribe(topic, group, handler) gorur; zarfin bes alani
sabittir (eventId, topic, partitionKey, occurredAt, payload) ve zarf yalnizca istege
bagli korelasyon alanlariyla genisler (asagidaki ek, D16). Ilk uygulama Redis Streams uzerinde
yazilir. Kafka'ya gecis, ayni arayuzu uygulayan tek bir dosya eklenip fabrikanin
dondurdugu bagimliligin degistirilmesi demektir; servis kodu degismez.

## Gerekce

Arayuz, en kucuk ortak paydada degil; Kafka'nin semantigi bilerek arayuze yansitildi.
partitionKey alani bugun Redis tarafinda siralamayi belirlemek icin kullaniliyor ama
Kafka'da dogrudan bolum anahtari olacak; tuketici grubu kavrami da her iki tarafta
ayni anlama geliyor. Boylece gecis sirasinda arayuzu genisletmek gerekmiyor. Dogrudan
Redis Streams cagrilari alternatifi elendi: hizli ama gecisi imkansiz kilar. Bugun
Kafka'ya gecmek de elendi: demo icin maliyeti faydasindan buyuk.

## Sonuclari

- Olumlu: tasima katmani degisse bile is kodu sabit kalir; testlerde bellek ici sahte
  bir uygulama takilarak olay akislari hizli test edilir.
- Olumsuz: uygulamaya ozgu ince ayarlar (bekleyen mesaj talebi, yeniden teslim esigi)
  arayuzun disinda, yapilandirma ile verilmek zorundadir.
- Kabul edilen borc: olay semalarinin surum yonetimi bugun yalnizca "alan ekle, alan
  silme" kuralina dayanir; sema kayit defteri yok.

## Ek: olay zarfinda korelasyon (D16, 2026-10-01)

Baglam: istek kimligi outbox adiminda kopuyordu. Bir siparisin olayini isleyen
tuketicinin gunlugu ve izi, olayi doguran istege baglanamiyordu (D15 izi gateway ile
servisler arasinda tasiyordu, olay hattinda degil).

Karar:

- Zarfa iki ISTEGE BAGLI alan eklendi: `requestId` (`req_` + 32 hex) ve `traceparent`
  (W3C, surum 00). Yoklugu gecerlidir: eski kayitlar ve istek disinda yazilan olaylar
  (seed) onlarsiz okunur.
- Ureten servis olayi yazdigi anda istegin baglamini outbox satirina saklar (order:
  ayni transaction); yayinci zarfa kopyalar. Yayin bir PRODUCER, isleme bir CONSUMER
  span'idir; tuketici zarftaki baglamin cocugu olur: istek -> outbox -> hat ->
  tuketici tek izdir (ADR-20).
- Tuketici zarftaki requestId'yi gunluge yazar ve isleyicinin baglamina koyar; yoksa
  yenisini uretir (RPC'deki kural).
- Korelasyon olayi takmaz: bicimsiz alan yayinda atilir (outbox durmaz), okumada atilir
  (olay olu olaylara gitmez). Olu olay kopyasi alanlari korur.

Gerekce: alan eklemek arayuzun "alan ekle, alan silme" kuralina uyar; Kafka'ya geciste
ikisi kayit basligi olur. Genel bir `headers` sozlugu elendi: sema gevser, izin listesi
delinir (kisisel veri girebilir).

## Ilgili

ADR-04, ADR-05, ADR-06, ADR-10, ADR-20; gorevler T1.5, D16.
