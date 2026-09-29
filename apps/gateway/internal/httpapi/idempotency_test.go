package httpapi

import (
	"net/http"
	"testing"
)

func TestMutationsRequireIdempotencyKey(t *testing.T) {
	cases := []struct{ path, body string }{
		{"/v1/cart/reserve", validReserveBody},
		{"/v1/orders", validPlaceBody},
		{"/v1/orders/" + testOrderID + "/3ds", `{"challengeId":"tds_1","otp":"123456"}`},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders)

		status, envelope := send(t, app, orderRequest(t, http.MethodPost, tc.path, tc.body, map[string]string{IdempotencyKeyHeader: ""}))

		if status != http.StatusBadRequest || detailsOf(t, envelope)[IdempotencyKeyHeader] != requiredReason {
			t.Errorf("%s: 400 + Idempotency-Key zorunlu bekleniyordu: %d %+v", tc.path, status, envelope)
		}
		if orders.called {
			t.Errorf("%s: anahtarsiz istekte servis cagrilmamaliydi", tc.path)
		}
	}
}
