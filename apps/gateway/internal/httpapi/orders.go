package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Siparis uclari (T7.5; openapi: reserveCart, createOrder,
// submitThreeDsChallenge, getOrder). Hepsi kimlik ister (requireUser); yazan
// uclar Idempotency-Key ister. Her handler ayni sirayi kurar: bilinmeyen sorgu
// parametresini reddet -> basligi ve govdeyi bicim olarak dogrula -> cagir ->
// zarfla. Bicim hatalari TEK cevapta toplanir.

const orderIDParam = "id"

// reserveCartHandler, POST /v1/cart/reserve: sepeti taslak siparise cevirir.
func reserveCartHandler(reserver CartReserver) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body reserveBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		key := idempotencyKeyOf(c, errs)
		input := body.toInput(userIDOf(c), key, errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		reservation, err := reserver.Reserve(outgoingContext(c), input)
		if err != nil {
			return err
		}
		return ok(c, http.StatusCreated, reservation)
	}
}

// placeOrderHandler, POST /v1/orders: risk -> odeme -> siparis zinciri. 3DS
// gerekirse siparis AWAITING_PAYMENT ve threeDs.challengeId ile doner.
//
// Risk sinyalleri (T8.1) bicim dogrulamasindan SONRA okunur: bicimsiz istek
// veritabanina gitmez. Oturum kapatilmissa sinyal okuyucu 401 doner.
func placeOrderHandler(placer OrderPlacer, signalReader CheckoutSignalReader) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body placeBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		key := idempotencyKeyOf(c, errs)
		input := body.toInput(userIDOf(c), key, errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		// IP baglantidan (B9): istemcinin yazabildigi X-Forwarded-For'a guvenilmez;
		// Fiber'da guvenilir vekil tanimli olmadikca c.IP() soketin adresidir.
		signals, err := signalReader.CheckoutSignals(c.Context(), identityOf(c), c.IP())
		if err != nil {
			return err
		}
		input.Signals = toOrderSignals(signals)

		placement, err := placer.Place(outgoingContext(c), input)
		if err != nil {
			return err
		}
		return ok(c, http.StatusCreated, placement)
	}
}

// confirmThreeDSHandler, POST /v1/orders/{id}/3ds: kod dogruysa siparis PAID.
func confirmThreeDSHandler(confirmer ThreeDSConfirmer) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body threeDSBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		key := idempotencyKeyOf(c, errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		input := body.toInput(userIDOf(c), c.Params(orderIDParam), key)
		placement, err := confirmer.ConfirmThreeDS(outgoingContext(c), input)
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, placement)
	}
}

// getOrderHandler, GET /v1/orders/{id}: kullanicinin tek siparisi.
func getOrderHandler(getter OrderGetter) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		found, err := getter.Get(outgoingContext(c), userIDOf(c), c.Params(orderIDParam))
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, found)
	}
}
