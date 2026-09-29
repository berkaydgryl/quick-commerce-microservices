package httpapi

import (
	"context"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Korelasyon kimliginin tasindigi baslik. Node servisleri ayni adi kullanir
// (service-kit: REQUEST_ID_METADATA_KEY), boylece tek istek uctan uca izlenir.
const RequestIDHeader = "X-Request-ID"

// requestIDMetadataKey, korelasyon kimliginin gRPC metadata anahtari
// (service-kit: REQUEST_ID_METADATA_KEY). Servis gunlugu ve hata yuku bu
// degeri tasir; gateway gunluguyle ayni istegi eslemek icin tek anahtar budur.
const requestIDMetadataKey = "x-request-id"

// requestIDLocalsKey, kimligin istek yerellerindeki anahtari. Disariya kapali
// tip, baska bir paketin anahtariyla carpismayi onler.
type requestIDLocalsKey struct{}

// requestIDMiddleware, her istege korelasyon kimligi baglar ve cevap basligina
// yazar.
//
// GELEN KIMLIK YALNIZCA BICIME UYARSA KABUL EDILIR (D8): baslik istemcinin
// elindedir ve kabul edilen deger her servisin gunlugune ve gRPC metadata'sina
// gider. Serbest metin kabul edilseydi birkac KB'lik bir deger her gunluk
// satirina girer, gunlukte iki bicim karisir ve kimlik tek desenle aranamazdi.
// Bicime uyan gelen kimlik KORUNUR: istemci kendi urettigi kimlikle istegini
// sonradan gunlukte bulabilir.
func requestIDMiddleware(c fiber.Ctx) error {
	// Bicim: "req_" + 32 kucuk onaltilik (ids paketi; @getir/core id.ts ile ayni).
	requestID := c.Get(RequestIDHeader)
	if !ids.Valid(ids.Request, requestID) {
		requestID = ids.New(ids.Request)
	}
	bindRequestID(c, requestID)
	return c.Next()
}

// ensureRequestID, istegin kimligini doner; yoksa uretip baglar.
//
// Ara katmana ULASMADAN dusen istekler icindir (govde siniri, bozuk baslik:
// Fiber bunlari dogrudan hata isleyiciye verir). Kimliksiz hata cevabi
// sozlesmeyi bozmaz ama gunlukle eslesmez; o istek sonradan bulunamazdi.
func ensureRequestID(c fiber.Ctx) string {
	if requestID := requestIDOf(c); requestID != "" {
		return requestID
	}
	requestID := ids.New(ids.Request)
	bindRequestID(c, requestID)
	return requestID
}

// bindRequestID, kimligi istege baglar ve cevap basligina yazar.
func bindRequestID(c fiber.Ctx, requestID string) {
	c.Set(RequestIDHeader, requestID)
	c.Locals(requestIDLocalsKey{}, requestID)
}

// requestIDOf, istege bagli kimligi doner; ara katmandan once bostur.
func requestIDOf(c fiber.Ctx) string {
	return fiber.Locals[string](c, requestIDLocalsKey{})
}

// outgoingContext, bagimli servis cagrisi icin baglam kurar: istemci baglantiyi
// kapatirsa cagri iptal olur ve korelasyon kimligi servise tasinir.
func outgoingContext(c fiber.Ctx) context.Context {
	return metadata.AppendToOutgoingContext(c.Context(), requestIDMetadataKey, requestIDOf(c))
}
