package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Harita adres uclari (T11.8; openapi: reverseGeocode, searchPlaces). Adres
// ekleme penceresi kullanir; oturum ister (Nominatim'e giden sira herkese
// acik olmasin). Koordinat ve arama kisisel konumdur: cevap onbelleklenmez.
// Aralik ve uzunluk kurallari geo paketindedir; burada yalnizca bicim.

// reverseGeocodeHandler, GET /v1/geo/reverse?lat=&lng=: noktanin adres satiri.
func reverseGeocodeHandler(reverser GeoReverser) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c, "lat", "lng"); err != nil {
			return err
		}
		errs := fieldErrors{}
		lat, lng := requiredFloat(c, "lat", errs), requiredFloat(c, "lng", errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		result, err := reverser.Reverse(c.Context(), lat, lng)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, result)
	}
}

// searchPlacesHandler, GET /v1/geo/search?q=: sokak, mahalle ya da posta kodu.
func searchPlacesHandler(searcher GeoSearcher) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c, "q"); err != nil {
			return err
		}
		result, err := searcher.Search(c.Context(), c.Query("q"))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, result)
	}
}
