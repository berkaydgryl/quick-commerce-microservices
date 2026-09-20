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
yalnizca publish(envelope) ve subscribe(topic, group, handler) gorur; zarf sabittir
(eventId, topic, partitionKey, occurredAt, payload). Ilk uygulama Redis Streams uzerinde
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

## Ilgili

ADR-04, ADR-05, ADR-06, ADR-10; gorev T1.5.
