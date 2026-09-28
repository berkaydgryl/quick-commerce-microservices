package httpapi

import (
	"net/http"
	"testing"
)

func TestPlaceOrderPaymentFormat(t *testing.T) {
	cases := []struct {
		name, body, field, reason string
	}{
		{"odeme yok", `{"orderId":"` + testOrderID + `"}`, "payment", requiredReason},
		{"kart disi yontem", `{"orderId":"` + testOrderID + `","payment":{"method":"CASH_ON_DELIVERY"}}`, "payment.method", "CARD olmali"},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders, true)

		status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", tc.body, nil))

		if status != http.StatusBadRequest || detailsOf(t, envelope)[tc.field] != tc.reason {
			t.Errorf("%s: 400 + %s bekleniyordu: %d %+v", tc.name, tc.field, status, envelope)
		}
		if orders.called {
			t.Errorf("%s: servis cagrilmamaliydi", tc.name)
		}
	}
}
