// Package httpapi, gateway'in HTTP yuzeyidir: yonlendirici, ara katmanlar ve
// cevap zarfi. Is mantigi tasimaz.
package httpapi

import (
	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Envelope, TUM REST cevaplarinin tek bicimi (packages/contracts ile ayni).
//
//	basarili : { "success": true,  "data": ... }
//	hatali   : { "success": false, "error": { code, message, details, requestId } }
//
// Hata bilgisi GRUPLUDUR; kokte ayri bir "message" alani yoktur. Tek zarf,
// istemcinin her cevabi ayni kodla acmasini saglar.
type Envelope struct {
	Success bool      `json:"success"`
	Data    any       `json:"data,omitempty"`
	Error   *APIError `json:"error,omitempty"`
}

// APIError, hata zarfinin govdesi. Kod sozlugu @getir/core ile ortaktir.
type APIError struct {
	Code    apperror.Code `json:"code"`
	Message string        `json:"message"`
	Details any           `json:"details,omitempty"`
	// Sozlesmede ZORUNLU (apiErrorSchema.requestId); omitempty yok.
	RequestID string `json:"requestId"`
}

// ok, basarili cevabi verilen durum koduyla yazar.
func ok(c fiber.Ctx, status int, data any) error {
	return c.Status(status).JSON(Envelope{Success: true, Data: data})
}

// fail, hatali cevabi yazar.
//
// HTTP kodu ve mesaj CAGIRANDAN ALINMAZ, koddan turetilir (apperror tablosu):
// ayni kod her uctan ayni durum ve ayni metinle doner. requestId gunlukteki
// kayitla ayni degerdir.
func fail(c fiber.Ctx, code apperror.Code, details any) error {
	return c.Status(apperror.HTTPStatus(code)).JSON(Envelope{
		Success: false,
		Error: &APIError{
			Code:      code,
			Message:   apperror.Message(code),
			Details:   details,
			RequestID: requestIDOf(c),
		},
	})
}
