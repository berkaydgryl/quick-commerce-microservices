package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/metadata"
)

// Korelasyon kimliginin tasindigi baslik. Node servisleri ayni adi kullanir
// (service-kit: REQUEST_ID_METADATA_KEY), boylece tek istek uctan uca izlenir.
const RequestIDHeader = "X-Request-ID"

// requestIDMetadataKey, korelasyon kimliginin gRPC metadata anahtari
// (service-kit: REQUEST_ID_METADATA_KEY). Servis gunlugu ve hata yuku bu
// degeri tasir; gateway gunluguyle ayni istegi eslemek icin tek anahtar budur.
const requestIDMetadataKey = "x-request-id"

// Korelasyon kimliginin bicimi: "req_" + 32 kucuk onaltilik karakter (16
// rastgele bayt). Kaynak @getir/core id.ts (ID_PREFIX.REQUEST, ID_BODY_PATTERN);
// Node servisleri kimligi kendileri urettiginde de bu bicimdedir.
const (
	requestIDPrefix    = "req_"
	requestIDBodyBytes = 16
)

// requestIDPattern, gelen kimlik icin kabul edilen TEK bicim.
var requestIDPattern = regexp.MustCompile(`^req_[0-9a-f]{32}$`)

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
	requestID := c.Get(RequestIDHeader)
	if !requestIDPattern.MatchString(requestID) {
		requestID = newRequestID()
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
	requestID := newRequestID()
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

// newRequestID, bicime uygun yeni bir kimlik uretir.
func newRequestID() string {
	var body [requestIDBodyBytes]byte
	// Go 1.24'ten beri crypto/rand.Read hata DONDURMEZ; kaynak okunamazsa
	// program kendisi durur (paket belgesi). Kontrol yine de yazilir: "hata
	// yutulmaz" kurali istisnasiz uygulansin.
	if _, err := rand.Read(body[:]); err != nil {
		panic(fmt.Errorf("korelasyon kimligi uretilemedi: %w", err))
	}
	return requestIDPrefix + hex.EncodeToString(body[:])
}

// outgoingContext, bagimli servis cagrisi icin baglam kurar: istemci baglantiyi
// kapatirsa cagri iptal olur ve korelasyon kimligi servise tasinir.
func outgoingContext(c fiber.Ctx) context.Context {
	return metadata.AppendToOutgoingContext(c.Context(), requestIDMetadataKey, requestIDOf(c))
}
