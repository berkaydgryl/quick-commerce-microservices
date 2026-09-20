# ADR-10: Calisma zamani dogrulamasi tek kutuphane ile yapilir (Zod)

- Durum: Kabul edildi
- Tarih: 2026-09-20

## Baglam

TypeScript tipleri derleme aninda silinir; sistemin sinirlarindan (HTTP govdesi, sorgu
parametreleri, ortam degiskenleri, olay zarflari, gRPC'den cevrilen mesajlar) gelen veri
hakkinda calisma zamaninda hicbir sey garanti etmez. Bu sinirlarda dogrulama yoksa hata,
veriyi kabul eden yerde degil cok sonra, ornegin stok dusulurken yuzeye cikar. Risk ise
her servisin farkli bir kutuphane secmesi ve ayni kavramin uc farkli sekilde
dogrulanmasidir.

## Karar

Calisma zamani dogrulamasi tek kutuphaneyle yapilir: Zod (^3.23.8). Sema tek kaynaktir ve
TypeScript tipleri z.infer ile semadan turer; ayni sekli iki kez (bir tip, bir sema)
yazmak yasaktir. Disaridan gelen hicbir veri parse edilmeden ice alinmaz; ortam
degiskenleri de acilista sema ile okunur ve gecersizse process baslamaz. Paylasilan
semalar @getir/contracts icinde durur ve servisler bunlari yeniden tanimlamaz.

## Gerekce

Tek kutuphane, hata mesajlarini ve dogrulama kurallarini tek bicimde tutar; "sema sahibi
tip" yaklasimi ise tip ile dogrulamanin zaman icinde birbirinden ayrilmasini yapisal
olarak imkansiz kilar. Elenen alternatifler: dekorator tabanli dogrulayicilar, sinif ve
dekorator zorunlulugu getirdigi icin sade ESM modulleriyle iyi calismiyor; JSON Schema
tabanli dogrulayicilar hizli ama tip cikarimi zayif; elle yazilmis tip korumalari ise
her sinirda tekrar eden ve unutulmaya acik koddur.

## Sonuclari

- Olumlu: gecersiz veri sinirda ve anlasilir bir mesajla reddedilir; sema ayni zamanda
  belgelenme islevi gorur ve sahte yanit uretiminde yeniden kullanilir (ADR-09).
- Olumsuz: sicak yolda her istek icin parse maliyeti vardir; buyuk diziler iceren
  uclarda sema mumkun oldugunca sade tutulur.
- Kabul edilen borc: proto tarafindaki mesajlar ile Zod semalari arasindaki esleme elle
  tutulur; otomatik uretim bugun planlanmadi.

## Ilgili

ADR-07, ADR-09, ADR-11; gorev T1.5.
