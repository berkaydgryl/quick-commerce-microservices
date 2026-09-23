package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// healthzHandler, bagimli servislerin durumunu doner.
//
// HTTP KODU SOZLESMESI: hepsi ayaktaysa 200, biri bile degilse 503. Probe'lar
// govdeyi degil kodu okur; insan ve panolar govdedeki servis listesini okur.
func healthzHandler(reporter HealthReporter) fiber.Handler {
	return func(c fiber.Ctx) error {
		report := reporter.Check(c.Context())
		if report.Healthy() {
			return ok(c, http.StatusOK, report)
		}
		return fail(c, apperror.CodeServiceUnavailable, report)
	}
}
