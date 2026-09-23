package httpapi

import (
	"context"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"google.golang.org/grpc/metadata"
)

// Korelasyon kimliginin tasindigi baslik. Node servisleri ayni adi kullanir
// (service-kit: REQUEST_ID_METADATA_KEY), boylece tek istek uctan uca izlenir.
const RequestIDHeader = "X-Request-ID"

// requestIDMetadataKey, korelasyon kimliginin gRPC metadata anahtari
// (service-kit: REQUEST_ID_METADATA_KEY). Servis gunlugu ve hata yuku bu
// degeri tasir; gateway gunluguyle ayni istegi eslemek icin tek anahtar budur.
const requestIDMetadataKey = "x-request-id"

// outgoingContext, bagimli servis cagrisi icin baglam kurar: istemci baglantiyi
// kapatirsa cagri iptal olur ve korelasyon kimligi servise tasinir.
func outgoingContext(c fiber.Ctx) context.Context {
	return metadata.AppendToOutgoingContext(c.Context(), requestIDMetadataKey, requestIDOf(c))
}

func requestIDOf(c fiber.Ctx) string {
	return requestid.FromContext(c)
}
