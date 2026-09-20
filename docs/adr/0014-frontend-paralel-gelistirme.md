# ADR-14: Frontend Gun 4'te baslar ve backend ile paralel ilerler

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Ilk planda arayuz, backend bittikten sonra ele alinacak bir kuyruk isiydi ve tasarim icin
ayrilmis hicbir gun yoktu. Bu plan iki bakimdan hatali: birincisi, bir backend hicbir
zaman "bitmez", sonraki isler surekli one gecer ve arayuze kalan sure her gecen gun
kisalir. Ikincisi ve daha belirleyicisi, bu isin degerlendirilme bicimi: demoyu izleyen
kisi mimariyi dogrudan gormez, gordugu sey arayuzdur. Zayif bir arayuz, arkasindaki
dogru kararlari da gorunmez kilar.

## Karar

Frontend Gun 4'te baslar ve MOCK=1 modundaki servisler uzerinden calisir (ADR-09); gercek
uclar hazirlandikca sahte yanitlarin yerini alir. Gun 4 ile Gun 15 arasinda frontend ve
backend paralel ilerler, yani her gun hem servis tarafinda hem arayuzde ilerleme
beklenir. Gun 16-20 yalnizca tasarim ve cilaya ayrilmistir: gorsel dil, bos/yukleniyor/
hata durumlari, hareket ve gecisler, erisilebilirlik ve demo akisinin provasi. Bu gunler
yeni ozellik icin kullanilmaz.

## Gerekce

Paralel ilerleme, arayuzu backend takviminin artigi olmaktan cikarir ve sozlesmelerin
gercekten kullanilabilir olup olmadigini her gun sinar; bir uc, ancak arayuz onu
kullanabildiginde bitmis sayilir. Tasarimi ayri ve korunmus bir dilime koymak ise cilanin
"zaman kalirsa" isi olmasini engeller; ADR-11'deki token disiplini sayesinde bu dilimde
yapilan degisiklikler tek yerde toplandigi icin ucuz kalir.

## Sonuclari

- Olumlu: demo izlenimi bastan planlanir; sozlesme hatalari erken yakalanir; her gun
  gosterilebilir bir ekran vardir.
- Olumsuz: gunluk baglam degistirme maliyeti artar ve sahte yanitlarin bakimi ek istir.
  Gercek uca gecis sirasinda arayuzde kucuk duzeltmeler kacinilmazdir.
- Kabul edilen borc: Gun 16-20 yalnizca cila icin korunur; o araliga tasan ozellik istegi
  kapsam disi birakilir.

## Ilgili

ADR-09, ADR-11, ADR-13; gorev T1.5.
