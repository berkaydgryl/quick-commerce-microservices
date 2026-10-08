package httpapi

import (
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// GET /v1/orders/{id}'deki 3DS durumu (#163 B1): cevapta aynen, onbelleksiz
// (no-store); jeton (challengeId) yetenek jetonudur ve gunluge YAZILMAZ.
// Acik/kapali/yok kurallari ve saat sinirlari order paketinde (three_ds_test.go).

const threeDSTestChallengeID = "tds_0009d7cd0e904b689aabcacf4458d520"

func TestGetOrderReturnsThreeDSPrivatelyAndNeverLogsTheChallengeID(t *testing.T) {
	var output lockedBuffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	orders := &fakeOrders{threeDS: &order.OrderThreeDS{ChallengeID: threeDSTestChallengeID, TTLSeconds: 42, AttemptsLeft: 2}}
	app := detailsApp(orders, logger, idempotency.NewMemory(time.Now))

	response, err := app.Test(orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	envelope := decode(t, response)

	data, isMap := envelope.Data.(map[string]any)
	if response.StatusCode != http.StatusOK || !isMap {
		t.Fatalf("200 bekleniyordu: %d %+v", response.StatusCode, envelope)
	}
	if got := testkit.JSON(t, data["threeDs"]); got != `{"attemptsLeft":2,"challengeId":"`+threeDSTestChallengeID+`","ttlSeconds":42}` {
		t.Errorf("threeDs cevapta aynen olmali: %s", got)
	}
	if cache := response.Header.Get(fiber.HeaderCacheControl); cache != noStore {
		t.Errorf("jeton tasiyan cevap onbelleklenmemeli: %q", cache)
	}
	if strings.Count(output.String(), "http istegi") == 0 {
		t.Fatalf("istek gunluge yazilmali:\n%s", output.String())
	}
	if strings.Contains(output.String(), "tds_") {
		t.Errorf("jeton gunluge yazilmamali:\n%s", output.String())
	}
}

func TestGetOrderWithoutThreeDSOmitsTheField(t *testing.T) {
	// Alan yok = bilinmiyor ya da dogrulama yok; null da yazilmaz.
	status, envelope := send(t, orderApp(&fakeOrders{}), orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", nil))

	data, isMap := envelope.Data.(map[string]any)
	if status != http.StatusOK || !isMap {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	if _, present := data["threeDs"]; present {
		t.Errorf("threeDs yazilmamali: %+v", data)
	}
}
