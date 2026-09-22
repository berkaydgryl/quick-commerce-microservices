// apps/gateway - tek dis kapi (Go + Fiber).
//
// AYRI MODUL: depo bir pnpm workspace'i ama Go tarafi kendi modul sinirini tasir.
// Uretilen proto kodu (packages/proto/gen/go) ayri bir moduldur ve asagidaki
// "replace" ile YEREL klasorden baglanir (T3.4). O modul hicbir yere
// yayinlanmaz; surum satiri (v0.0.0) yalnizca Go'nun "require" soz dizimi icin
// vardir, gercek kaynak her zaman depodaki klasordur.
//
// DIKKAT: gen/ depoya GIRMEZ. Gateway'i derlemeden once Go kodu uretilmelidir:
//   pnpm proto:gen      (ya da packages/proto icinde: buf generate --template buf.gen.go.yaml)
// Uretilmezse hata "no required module provides package .../gen/go/getir/catalog/v1"
// olarak cikar.
module github.com/berkaydgryl/quick-commerce-microservices/apps/gateway

go 1.25.0

require (
	github.com/berkaydgryl/quick-commerce-microservices/packages/proto v0.0.0-00010101000000-000000000000
	github.com/gofiber/fiber/v3 v3.5.0
	google.golang.org/grpc v1.84.0
)

require (
	github.com/andybalholm/brotli v1.2.2 // indirect
	github.com/gofiber/schema v1.8.3 // indirect
	github.com/gofiber/utils/v2 v2.4.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/klauspost/compress v1.19.2 // indirect
	github.com/mattn/go-colorable v0.1.15 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/philhofer/fwd v1.2.0 // indirect
	github.com/tinylib/msgp v1.6.4 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasthttp v1.73.0 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/net v0.57.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260706201446-f0a921348800 // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)

replace github.com/berkaydgryl/quick-commerce-microservices/packages/proto => ../../packages/proto
