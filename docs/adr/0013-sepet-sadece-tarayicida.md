# ADR-13: Sepet durumu sunucuda tutulmaz, tarayicida yasar

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

Sepet, kullanicinin henuz karar vermedigi bir niyet listesidir. Sunucuda tutulursa her
adet degisikligi bir yazma istegi olur, sepet koleksiyonu terk edilmis kayitlarla dolar
ve anonim kullanici icin ayri bir sepet kimligi yasam dongusu yonetmek gerekir. Daha
onemlisi kavram karisir: sepette urun bulunmasi ile o urunun kullanici adina ayrilmis
olmasi ayni sey degildir, ama ikisi de sunucuda durursa ayni sey sanilir.

## Karar

Sepet durumu yalnizca tarayicida tutulur: Zustand deposu, localStorage'a kalici yazilir.
Sunucuda sepet koleksiyonu ve sepet ucu yoktur. Sepetin sunucudaki karsiligi
rezervasyondur: kullanici odeme adimina gectiginde sepet kalemleri rezervasyon istegine
cevrilir, stok o anda ayrilir ve suresi ADR-02'deki kurallara tabidir. Sepet gorunumunde
gosterilen fiyat ve stok bilgisi bilgilendirmedir; baglayici kontrol rezervasyon aninda
sunucuda yapilir.

## Gerekce

Bu ayrim "ilgilendim" ile "ayirttim" arasindaki farki hem kod hem urun duzeyinde net
tutar ve stogun yalnizca gercek niyet icin kilitlenmesini saglar. Ayrica sepet islemleri
ag gecikmesi olmadan aninda tepki verir ve backend'e anlamsiz yazma yuku binmez.
Sunucu tarafli sepet alternatifi elendi: cihazlar arasi senkron kazanci, getirdigi
kalicilik, temizlik ve kimlik yukunun altinda kaliyor.

## Sonuclari

- Olumlu: arayuz aninda tepki verir, sunucu durumsuz kalir, terk edilmis sepet temizligi
  diye bir is olusmaz.
- Olumsuz: sepet cihazlar arasinda senkronlanmaz ve tarayici verisi silinirse kaybolur.
  Fiyat veya stok sepet dururken degisebilecegi icin odeme oncesi yeniden dogrulama
  zorunludur ve arayuz degisen kalemi kullaniciya acikca bildirir.
- Kabul edilen borc: birden fazla sekmede acik sepetlerin senkronu ele alinmaz.

## Ilgili

ADR-02, ADR-08, ADR-11, ADR-14; gorev T1.5.
