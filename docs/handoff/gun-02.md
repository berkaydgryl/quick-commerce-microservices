# Gun 2 baslangic promptu (Cursor)

Asagidaki metni Cursor sohbetine (Agent modu) yapistir.

---

Bu repoda 20 gunluk plana gore ilerliyoruz. Gun 0 ve Gun 1 (T1.1-T1.6) tamamlandi ve main'e merge edildi.
Simdi Gun 2'ye basliyoruz.

Once sunlari oku: `docs/roadmap.md` (ozellikle "Sozlesmeler: gRPC, REST, Socket" bolumu ve Gorev Panosu'ndaki
T2.1-T2.5 satirlari), `docs/adr/` altindaki ADR-01, 04, 07, 08, 09, 10, `packages/proto` (buf.yaml, buf.gen.yaml,
common.proto, catalog.proto) ve `packages/core`.

Gun 2 gorevleri, bu sirayla ve her biri ayri dal + ayri PR:

1. T2.1 [contract] `inventory`, `order`, `payment`, `risk`, `courier` proto dosyalari. RPC listesi roadmap'teki
   tablodan gelir. catalog.proto'daki stil ve yorum yogunlugunu izle. Bitti: `pnpm lint:proto` temiz.
2. T2.2 [contract] `packages/contracts`: REST DTO Zod semalari (cart, order, product), socket olay payload'lari,
   `ApiResponse<T>` zarfi, hata kodu -> kullanici mesaji sozlugu, `z.infer` tipleri. Bitti: web ve gateway'in
   ayni tipi import edebilecegi sekilde build olur, birim testleri gecer.
3. T2.3 [platform] `pnpm proto:gen` gercek uretime baglanir (ts-proto + protoc-gen-go + protoc-gen-go-grpc).
   Eklenti kurulumunu Windows'ta calisacak sekilde belgele. Bitti: uretilen tipler TS ve Go'da derlenir.
4. T2.4 [platform] `packages/service-kit`: gRPC bootstrap, health RPC, Zod dogrulama ara katmani, AppError ->
   gRPC status cevirisi, graceful shutdown. Bitti: ornek servis ayaga kalkar, `grpcurl` health cevabi verir.
5. T2.5 [platform] `packages/mongo-kit` + `packages/redis-kit`: client, repository tabani, Lua yukleyici,
   `{store}` hash-tag'li key builder. Bitti: Testcontainers ile entegrasyon testi baglanir.

Kurallar `.cursor/rules/proje-kurallari.mdc` icinde. Ilk olarak T2.1 icin kisa bir plan cikar (dosyalar,
mesajlar, dogrulama), onayimi bekle, sonra uygula. Gorev bitince `pnpm verify` calistir ve sonucu goster.

Bilinen kucuk duzeltmeler (uygun bir PR'a ekle): kok package.json'daki TODO script'lerinde `race` Gun 11
(T11.1), `demo` Gun 15 (T15.1) olmali; `BatchGetProducts` RPC'si roadmap'teki catalog satirina eklenmeli.
