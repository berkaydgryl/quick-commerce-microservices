package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"
)

// welcomeContentHandler, GET /v1/content/welcome (T11.6): oturumsuz
// ziyaretcinin karsilama ekraninin metinleri ve gorselleri.
//
// Handler yalnizca sirayi kurar: dogrula -> oku -> zarfla. Icerigin kaynagi
// ve dogrulamasi internal/content'tedir.
func welcomeContentHandler(source WelcomeContentGetter) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Sozlesmede bu ucun sorgu parametresi YOK (openapi: getWelcomeContent).
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}

		welcome, err := source.Welcome(c.Context())
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, welcome)
	}
}
