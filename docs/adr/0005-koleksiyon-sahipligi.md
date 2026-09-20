# ADR-05: Her servis kendi koleksiyonlarinin tek sahibidir

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Tum servisler ayni Mongo ornegini paylasiyor. Paylasilan veritabaninda en ucuz kisa yol,
bir servisin ihtiyaci olan veriyi baska servisin koleksiyonundan dogrudan okumasidir;
en tehlikelisi ise oraya yazmasidir. Bu kisa yol alindiginda mikroservis sinirlari
kagit uzerinde kalir: sema degisikligi hangi servisleri bozacagini kimse bilemez,
dogrulama kurallari atlanir ve hata ayiklarken bir belgeyi kimin degistirdigi
bulunamaz.

## Karar

Her koleksiyonun tek bir sahip servisi vardir ve sema o servise aittir. Baska bir
servisin koleksiyonuna yazmak reddedilir; okumak da reddedilir. Servisler arasi veri
erisimi yalnizca gRPC uclari uzerinden olur. Surekli ihtiyac duyulan veri icin, olay
hattindan beslenen yerel bir projeksiyon tutulur ve bu projeksiyonun sahibi de onu
tutan servistir. Koleksiyon adlari sahibi acik olacak sekilde secilir ve sahiplik
tablosu servis README'sinde yazilidir.

## Gerekce

Sahiplik, semayi degistirilebilir tutan tek seydir: alan eklemek ya da indeks degistirmek
yalnizca sahibi ilgilendirir. gRPC uzerinden erisim ayni zamanda sozlesmeyi gorunur
kilar; kim kimden ne istiyor proto dosyasinda okunur (ADR-09). Paylasilan okuma
serbestisi alternatifi elendi, cunku okuma bagimliligi da bagimliliktir ve ilk sema
degisikliginde yazma kadar kirilgan oldugu ortaya cikar.

## Sonuclari

- Olumlu: patlama yaricapi kucuk, sema gocu yerel, veri butunlugu tek yerde korunur.
- Olumsuz: capraz veriler icin ek ag cagrisi gerekir ve n+1 sorgu riski dogar; bunu
  onlemek icin uclar toplu (batch) surumleriyle birlikte tasarlanir. Veritabani
  seviyesinde join yapilamaz, birlestirme cagiran serviste yapilir.
- Kabul edilen borc: sahiplik bugun sozlesmeye dayali bir kuraldir, ayri kullanici veya
  ayri veritabani ile teknik olarak zorlanmaz.

## Ilgili

ADR-03, ADR-04, ADR-07, ADR-09; gorev T1.5.
