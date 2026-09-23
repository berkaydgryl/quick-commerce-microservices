package httpapi

import (
	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// unknownQueryReason, bilinmeyen parametrenin details'teki aciklamasi.
const unknownQueryReason = "bu uc bu parametreyi kabul etmiyor"

// rejectUnknownQuery, izin verilmeyen her sorgu parametresini reddeder.
//
// NEDEN SESSIZCE YOK SAYMIYORUZ: yazim hatali bir filtre (?categoryid= yerine
// ?categoryID=) yok sayilirsa istemci filtrelenmemis listeyi filtrelenmis
// sanar ve hata ekranda "yanlis urunler" olarak gorunur. 400 + alan adi hatayi
// istegin yapildigi anda gosterir. Bicim, Node servislerinin dogrulama
// hatasiyla ayni: details = { alan: sebep }.
func rejectUnknownQuery(c fiber.Ctx, allowed ...string) error {
	permitted := make(map[string]struct{}, len(allowed))
	for _, name := range allowed {
		permitted[name] = struct{}{}
	}

	details := map[string]string{}
	for name := range c.Queries() {
		if _, ok := permitted[name]; !ok {
			details[name] = unknownQueryReason
		}
	}
	if len(details) == 0 {
		return nil
	}
	return apperror.New(apperror.CodeValidationFailed, details)
}
