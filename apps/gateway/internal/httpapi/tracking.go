package httpapi

import (
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v3"
)

// Kurye takibinin REST ucu (T14.2; openapi: getOrderTracking). Sahiplik,
// durum ve takip kurallari tracking.Service'tedir; burada yalnizca kullanici
// ve yol kimligi alinir, cevap onbelleklenmez.

// orderTrackingHandler, GET /v1/orders/{id}/tracking. Konum kisisel veridir:
// cevap no-store, gunluge hicbir koordinat yazilmaz (istek gunlugu yalnizca yol
// ve kodu, hata gunlugu yalnizca kodu ve nedeni tasir).
func orderTrackingHandler(tracker OrderTracker) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		// Yol parametresinin KOPYASI (cardIDOf ile ayni gerekce, #87).
		found, err := tracker.Track(outgoingContext(c), userIDOf(c), strings.Clone(c.Params(orderIDParam)))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, found)
	}
}
