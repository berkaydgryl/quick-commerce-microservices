package httpapi

import (
	"net/http"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

func TestOrderEndpointsRequireUser(t *testing.T) {
	cases := []struct {
		method, path, body string
	}{
		{http.MethodPost, "/v1/cart/reserve", validReserveBody},
		{http.MethodPost, "/v1/orders", validPlaceBody},
		{http.MethodPost, "/v1/orders/" + testOrderID + "/3ds", `{"challengeId":"tds_1","otp":"123456"}`},
		{http.MethodGet, "/v1/orders/" + testOrderID, ""},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders, true)

		status, envelope := send(t, app, orderRequest(t, tc.method, tc.path, tc.body, map[string]string{UserIDHeader: ""}))

		if status != http.StatusUnauthorized || envelope.Error == nil || envelope.Error.Code != apperror.CodeUnauthorized {
			t.Errorf("%s %s: 401 UNAUTHORIZED bekleniyordu: %d %+v", tc.method, tc.path, status, envelope)
		}
		if orders.called {
			t.Errorf("%s %s: kimliksiz istekte servis cagrilmamaliydi", tc.method, tc.path)
		}
	}
}

func TestInvalidDemoUserIsRejected(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders, true)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", map[string]string{UserIDHeader: "admin; drop"}))

	if status != http.StatusUnauthorized || detailsOf(t, envelope)[UserIDHeader] != userIDReason {
		t.Errorf("bicimsiz kimlik 401 ve alan adiyla donmeli: %d %+v", status, envelope)
	}
}

func TestProductionIgnoresDemoUserHeader(t *testing.T) {
	// JWT (T8.1) gelene kadar production'da korumali uc HIC acilmaz: baslik
	// kabul edilseydi herkes kendini baska biri gibi tanitabilirdi.
	orders := &fakeOrders{}
	app := orderApp(orders, false)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))

	if status != http.StatusUnauthorized || envelope.Error.Details != nil {
		t.Errorf("401 ve ayrintisiz cevap bekleniyordu: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("production'da servis cagrilmamaliydi")
	}
}
