package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"
)

// Gercek zamanli katmanin REST ucu (T12.2; openapi: getOrderRealtimeToken).
// Siparis odasina (order:{id}) katilmak icin kisa omurlu jeton verir; jetonun
// kendisi realtime-service'in room.join'inde dogrulanir. Sahiplik adaptorde
// (roomtoken.Service): baskasinin siparisi 404, var oldugu sizdirilmaz.

// orderRoomTokenHandler, GET /v1/orders/{id}/token.
func orderRoomTokenHandler(tokens OrderRoomTokenIssuer) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		issued, err := tokens.Issue(outgoingContext(c), userIDOf(c), c.Params(orderIDParam))
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, issued)
	}
}
