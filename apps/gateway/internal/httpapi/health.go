package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// healthPath, altyapi yoklamasinin yolu (Docker HEALTHCHECK her 15 sn'de).
// Iz acilmaz (D15, ADR-20): her yoklama bir iz olsaydi goruntuleyici
// gurultuyle dolardi.
const healthPath = "/healthz"

// healthzHandler, bagimli servislerin durumunu doner.
//
// HTTP KODU SOZLESMESI: hepsi ayaktaysa 200, biri bile degilse 503. Probe'lar
// govdeyi degil kodu okur; insan ve panolar govdedeki servis listesini okur.
//
// Saglik sorgusu da korelasyon kimligini servislere tasir (D8): servisin
// saglik kaydi (Health.Check, debug seviyesi) gateway gunluguyle eslesir.
func healthzHandler(reporter HealthReporter) fiber.Handler {
	return func(c fiber.Ctx) error {
		report := reporter.Check(outgoingContext(c))
		if report.Healthy() {
			return ok(c, http.StatusOK, report)
		}
		return fail(c, apperror.CodeServiceUnavailable, report)
	}
}
