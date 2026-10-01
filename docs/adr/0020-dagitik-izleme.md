# ADR-20: Dagitik izleme OpenTelemetry ile, span'ler RPC sinirlarinda ve nitelikler izin listeli

- Durum: Kabul edildi
- Tarih: 2026-10-01

## Baglam

Mimari denetim (28.09, D15) korelasyonun yalnizca `x-request-id` ile yapildigini buldu:
bir istegin gateway -> order -> risk/payment yolunu gormek icin her servisin gunlugunde
ayni kimlik elle aranir; hangi adimin ne kadar surdugu, hangi cagrinin hata verdigi
gorunmez. Roadmap'in bitti tanimi: bir siparis istegi bu yol boyunca TEK iz olarak
gorulur ve gunluk satiri iz kimligini tasir.

Gateway Go (Fiber v3), servisler Node; iki dil ayni iz baglamini tasimali. T10.5'te
(#49) hata kodlarina agirlik verildi (beklenen is sonucu, siradisi, beklenmeyen);
izdeki hata isareti de ayni ayrimi yapmali. Proje kurali gunlukte kisisel veri
yasaklar; izler de ayni depoya (goruntuleyici) yazilan telemetridir.

## Karar

- **OpenTelemetry**, baglam **W3C `traceparent`** ile tasinir (yalnizca trace context;
  baggage yok): HTTP basliginda (gateway'e gelen) ve gRPC metadata'sinda.
- **Span'ler RPC sinirlarinda, elle** acilir:
  - gateway: her HTTP istegi (sunucu) ve giden her gRPC cagrisi (istemci);
  - Node: service-kit `unaryHandler` (sunucu, ust span gelen traceparent'tan) ve
    `callUnary`'nin cagri ara katmani (istemci).
    Mongo/Redis cagrilari icin span yoktur; otomatik enstrumantasyon (`--import` kancasi)
    kullanilmaz.
- **Kutuphane kodu yalnizca API'yi kullanir**: service-kit `@opentelemetry/api`'ye,
  gateway paketleri `trace.Tracer`'a baglidir. SDK ve disari gonderen (OTLP/HTTP) tek
  yerde kurulur: Node'da `@getir/observability` (`startTracing`, startGrpcServer
  cagirir), gateway'de `internal/telemetry` (main). Saglayicisiz API hicbir sey yapmaz.
- **Nitelikler izin listelidir**: yontem, rota kalibi, yol, durum kodu, `rpc.*`,
  `app.request_id`, `app.error_code`. Sorgu dizesi (konum, arama metni), istemci IP'si,
  kullanici ajani ve govde **yazilmaz**. Span adi rota kalibidir (`POST /v1/orders`),
  ham yol degildir; eslesmeyen yolda yalnizca yontem.
- **Hata isareti agirliktan**: beklenen is sonucu span'i hatali isaretlemez; siradisi
  ve beklenmeyen hata ERROR olur (Node: `ERROR_CODE_SEVERITY`; gateway gRPC'de ayni
  ayrimin durum kodu karsiligi; HTTP'de 5xx).
- **Her istek orneklenir** (ParentBased(AlwaysOn)): yerel gelistirme; oran ayari
  gerekince ortam degiskeniyle eklenir.
- **Saglik yoklamalari izlenmez**: `/healthz` (Docker her 15 sn'de), gRPC health
  cagrilari ve `/metrics` span acmaz; her yoklama bir iz olsaydi goruntuleyici
  gurultuyle dolardi.
- **Uc adresi** `OTEL_EXPORTER_OTLP_ENDPOINT` (standart ad, OTLP/HTTP). **Yoksa span'ler
  yine olusur ve tasinir** (gunluk satirinda `traceId`), yalnizca disari gonderilmez.
- **Gunluk korelasyonu**: span icinde yazilan her satir `traceId` ve `spanId` tasir
  (Node: pino mixin; gateway: slog isleyicisi). `requestId` AYRI kalir ve span'e
  `app.request_id` olarak yazilir: REST hatasindaki kimlikle iz bulunur.
- **Olay hatti (D16, ADR-07 eki)**: zarf `requestId` ve `traceparent` tasir. Outbox
  satiri olayi yazan istegin baglamini saklar; yayin PRODUCER (`publish <konu>`), isleme
  CONSUMER (`process <konu>`) span'idir ve tuketici yayinin cocugudur. Nitelikler
  `messaging.*`, `app.request_id`, `app.delivery_attempt`; govde yazilmaz.
- **Kapanis**: bekleyen span'ler en son, en cok 2 sn'de gonderilir.
- **Goruntuleyici**: Jaeger v2 (`jaegertracing/jaeger`), docker-compose.dev.yml'de;
  izler bellekte.

## Gerekce

- W3C trace context iki dilin de varsayilanidir; Go ve Node ayni baslikla konusur.
- RPC sinirindaki span'ler bitti tanimini (gateway -> order -> risk/payment tek iz)
  karsilar ve hangi servisin ne kadar surdugunu gosterir. Otomatik enstrumantasyon ESM'de
  baslatma kancasi ister (baslatma komutu ve Docker CMD degisir, kanca kirilgan);
  Mongo/Redis span'leri gerekirse ayrica eklenir.
- Resmi Fiber ara katmani (gofiber/contrib/v3/otel) kullanilmadi: sorguyu ve tam adresi
  (`url.query`, `url.full`) her zaman yazar, kapatilamaz; bizim sorgularimizda konum ve
  arama metni vardir. Son surumu ayrica Go 1.26 ister.
- otelgrpc'nin istemci span'i OK disi her kodu hata isaretler (kodda sabit); is sonucu
  (stok yok) gateway'in span'inde hata gorunur, servisin span'inde gorunmezdi. Iki
  dilin istemci ara katmani ayni kurali uygular.
- `requestId`'yi iz kimliginden turetmek (tek kimlik) disaridan gelen kimligi (D8)
  ve izsiz calismayi karmasiklastirirdi; ayri tutup span'e yazmak ikisini de korur.

## Sonuclari

- Olumlu: bir istegin butun yolu tek izde; gunluk satiri ile iz birbirine bagli; iki
  dil ayni nitelik adlarini kullanir; kisisel veri ize girmez.
- Olumsuz: veritabani cagrilari izde tek tek gorunmez (servis span'inin suresine dahil).
  Her istek orneklendigi icin yuksek yukte oran ayari gerekir. Izler bellekte: Jaeger
  yeniden baslayinca gider.
- Olay hattinda iz D16'da eklendi (ADR-07 eki). Gateway metrikleri (#29) iz degil, metrik
  isidir (`internal/metrics`).

## Ilgili

ADR-07 (olay zarfi ve D16 eki), ADR-10; gorevler D15, D16, T10.5 (#49); proje kurallari
"Gozlemlenebilirlik".
