# ADR-09: Sozlesme koddan once yazilir, MOCK=1 modu zorunludur

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Sekiz servis ve bir web uygulamasi ayni takvimde ilerliyor. Sozlesme koddan sonra
cikarilirsa iki sorun kacinilmaz olur: uclar servisin ic modeline gore sekillenir ve
sizinti yapar, ayrica frontend gercek uc hazir olana kadar bekler ya da atilacak gecici
kod yazar. Bekleme, arayuze ayrilan zamani dogrudan yer ve demo izlenimi buyuk olcude
arayuzden okunur (ADR-14).

## Karar

Her uc once sozlesme olarak yazilir: gRPC yuzeyi @getir/proto icindeki proto
dosyalarinda, HTTP yuzeyi ve ortak tipler @getir/contracts icindeki Zod semalarinda
tanimlanir; bunlar tek kaynaktir ve kod bunlardan turer. Her Node servisi MOCK=1
ortam degiskeniyle acildiginda, is mantigi ve veri deposu olmadan sozlesmeye uygun,
deterministik ornek yanitlar dondurur. Sozlesme degisikligi ayri ve gorunur bir adimdir;
once sozlesme guncellenir, sonra uygulama takip eder.

## Gerekce

Sozlesmeyi once yazmak, tartismayi alan adlari ve hata durumlari uzerine cekerek ic
modeli disariya sizdirmayi engeller. MOCK=1 ise frontend'i backend takvimine bagimli
olmaktan kurtarir ve ayni sahte yanitlar test ile demo senaryolarinda yeniden kullanilir.
Ayri bir sahte sunucu kurmak alternatifi elendi: sozlesme ile sahte yanit iki ayri yerde
durunca kacinilmaz olarak birbirinden ayrilir. Gercek servisi beklemek ise en pahali
secenekti.

## Sonuclari

- Olumlu: arayuz ve servis gercekten paralel ilerler; sozlesme kirilmalari uygulama
  yazilmadan once gorunur; belgelenme ekstra is degil, kaynagin kendisidir.
- Olumsuz: iki yuzey (proto ve Zod) birbirine elle hizali tutulmak zorundadir ve her
  uc icin ek bir sahte yanit yazilir.
- Kabul edilen borc: MOCK=1 yollari gercek yollarla ayni testlerden gecmez; yalnizca
  sema uyumu dogrulanir.

## Ilgili

ADR-05, ADR-10, ADR-14; gorev T1.5.
