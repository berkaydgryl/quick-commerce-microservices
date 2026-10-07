package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/roomtoken"
)

// Siparis okumalari (#186): GET /v1/orders, /v1/orders/{id} ve
// /v1/orders/{id}/token kisisel veri tasir (adres, urunler, 3DS jetonu, oda
// jetonu). HER cevap, hata dahil, no-store: noStoreRoute rotanin ILK ara
// katmanidir; kimlik (401), hiz siniri (429), sorgu (400) ve uc hatalari
// (404, 500, 503) baslik yazilmis olarak doner.

// orderReadsApp, uc okuma ucunu gercek oda jetonu servisiyle kurar (sahiplik
// sahte siparis adaptorunden; roomTokenApp ile ayni baglama).
func orderReadsApp(orders *fakeOrders, adjust ...func(*Deps)) *fiber.App {
	signer := roomtoken.NewSigner([]byte(testRoomSecret), func() time.Time {
		return time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	})
	tokens := roomtoken.NewService(func(ctx context.Context, userID, orderID string) error {
		_, err := orders.Get(ctx, userID, orderID)
		return err
	}, signer)
	deps := Deps{
		Health:          fakeReporter{report: healthyReport()},
		OrderGetter:     orders,
		OrderLister:     orders,
		OrderRoomTokens: tokens,
		AccessTokens:    testTokens(),
		Logger:          silentLogger(),
	}
	for _, change := range adjust {
		change(&deps)
	}
	return New(deps)
}

// orderReadPaths, no-store zorunlu siparis okumalari (rota adi -> yol).
var orderReadPaths = map[string]string{
	"liste":       "/v1/orders",
	"tek siparis": "/v1/orders/" + testOrderID,
	"oda jetonu":  "/v1/orders/" + testOrderID + "/token",
}

func readRequest(t *testing.T, path string, headers map[string]string) *http.Request {
	t.Helper()
	merged := map[string]string{IdempotencyKeyHeader: ""}
	for name, value := range headers {
		merged[name] = value
	}
	return orderRequest(t, http.MethodGet, path, "", merged)
}

func TestOrderReadsAreNeverCachedIncludingErrors(t *testing.T) {
	for _, tc := range []struct {
		name    string
		orders  *fakeOrders
		query   string
		headers map[string]string
		status  int
	}{
		{name: "200", orders: &fakeOrders{}, status: http.StatusOK},
		{name: "400 bilinmeyen sorgu", orders: &fakeOrders{}, query: "?userId=usr_baska", status: http.StatusBadRequest},
		{name: "401 kimliksiz", orders: &fakeOrders{}, headers: map[string]string{fiber.HeaderAuthorization: ""}, status: http.StatusUnauthorized},
		{name: "404 baskasinin siparisi", orders: &fakeOrders{err: apperror.New(apperror.CodeNotFound, map[string]string{"orderId": testOrderID})}, status: http.StatusNotFound},
		{name: "500 beklenmeyen", orders: &fakeOrders{err: &apperror.Error{Code: apperror.CodeInternal}}, status: http.StatusInternalServerError},
		{name: "503 order kapali", orders: &fakeOrders{err: &apperror.Error{Code: apperror.CodeServiceUnavailable}}, status: http.StatusServiceUnavailable},
	} {
		for route, path := range orderReadPaths {
			t.Run(route+"/"+tc.name, func(t *testing.T) {
				got, header, _ := exchange(t, orderReadsApp(tc.orders), readRequest(t, path+tc.query, tc.headers))

				if got != tc.status {
					t.Fatalf("%d bekleniyordu: %d", tc.status, got)
				}
				if header.Get(fiber.HeaderCacheControl) != noStore {
					t.Errorf("no-store bekleniyordu: %q", header.Get(fiber.HeaderCacheControl))
				}
			})
		}
	}
}

func TestOrderReadsRateLimitedResponseIsNotCached(t *testing.T) {
	// 429 hiz sinirindan (rota uca ulasmadan) doner: baslik yine yazilmis olmali.
	for route, path := range orderReadPaths {
		t.Run(route, func(t *testing.T) {
			app := orderReadsApp(&fakeOrders{}, func(deps *Deps) {
				deps.RateLimit = memoryLimits(newTestClock(), 1, 10, 10)
			})

			first, _, _ := exchange(t, app, readRequest(t, path, nil))
			second, header, envelope := exchange(t, app, readRequest(t, path, nil))

			if first != http.StatusOK || second != http.StatusTooManyRequests || envelope.Error == nil || envelope.Error.Code != apperror.CodeRateLimited {
				t.Fatalf("200 sonra 429 bekleniyordu: %d %d %+v", first, second, envelope)
			}
			if header.Get(fiber.HeaderCacheControl) != noStore {
				t.Errorf("429 da no-store olmali: %q", header.Get(fiber.HeaderCacheControl))
			}
		})
	}
}
