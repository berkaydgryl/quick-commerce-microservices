package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/roomtoken"
)

const testRoomSecret = "test-oda-jetonu-sirri-en-az-otuz-iki-bayt"

// roomTokenApp, ucu GERCEK roomtoken.Service ile kurar; sahiplik sahte siparis
// adaptorunden (bootstrap'taki baglamanin aynisi): Get hata donerse imza atilmaz.
func roomTokenApp(orders *fakeOrders) *fiber.App {
	signer := roomtoken.NewSigner([]byte(testRoomSecret), func() time.Time {
		return time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	})
	tokens := roomtoken.NewService(func(ctx context.Context, userID, orderID string) error {
		_, err := orders.Get(ctx, userID, orderID)
		return err
	}, signer)
	return New(Deps{
		Health:          fakeReporter{report: healthyReport()},
		OrderGetter:     orders,
		OrderRoomTokens: tokens,
		AccessTokens:    testTokens(),
		Logger:          silentLogger(),
	})
}

func roomTokenPath() string {
	return "/v1/orders/" + testOrderID + "/token"
}

func TestOrderRoomTokenForOwner(t *testing.T) {
	orders := &fakeOrders{}
	app := roomTokenApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, roomTokenPath(), "",
		map[string]string{IdempotencyKeyHeader: "", RequestIDHeader: testRequestID}))

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	if !orders.called {
		t.Fatal("sahiplik siparis servisine sorulmadan jeton verildi")
	}
	if orders.getUserID != testUserID || orders.getOrderID != testOrderID {
		t.Errorf("sahiplik kullanici ve yol kimligiyle sorulmali: %q %q", orders.getUserID, orders.getOrderID)
	}
	outgoing, _ := metadata.FromOutgoingContext(orders.ctx)
	if got := outgoing.Get(requestIDMetadataKey); len(got) != 1 || got[0] != testRequestID {
		t.Errorf("korelasyon kimligi sahiplik cagrisina tasinmali: %v", got)
	}
	data, ok := envelope.Data.(map[string]any)
	if !ok {
		t.Fatalf("data nesne olmali: %+v", envelope.Data)
	}
	if data["room"] != "order:"+testOrderID || data["ttlSeconds"] != float64(60) || data["expiresAt"] != "2026-10-03T12:01:00Z" {
		t.Errorf("oda, omur ve bitis: %+v", data)
	}
	if token, _ := data["token"].(string); token == "" {
		t.Error("jeton bos olmamali")
	}
}

func TestOrderRoomTokenForTerminalOrderIsAllowed(t *testing.T) {
	// QA 75: teslim edilmis ya da iptal siparisin sahibi de son durumu izleyebilir;
	// uc siparisin durumuna bakmaz (sahte adaptor her durumda siparis doner).
	app := roomTokenApp(&fakeOrders{})

	status, _ := send(t, app, orderRequest(t, http.MethodGet, roomTokenPath(), "", map[string]string{IdempotencyKeyHeader: ""}))

	if status != http.StatusOK {
		t.Errorf("200 bekleniyordu: %d", status)
	}
}

func TestOrderRoomTokenForOthersOrderIsNotFound(t *testing.T) {
	// Baskasinin siparisi order-service'te NOT_FOUND (varligi sizdirilmaz).
	orders := &fakeOrders{err: apperror.New(apperror.CodeNotFound, map[string]string{"orderId": testOrderID})}
	app := roomTokenApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, roomTokenPath(), "", map[string]string{IdempotencyKeyHeader: ""}))

	if status != http.StatusNotFound || envelope.Error == nil || envelope.Error.Code != apperror.CodeNotFound {
		t.Fatalf("404 NOT_FOUND bekleniyordu: %d %+v", status, envelope)
	}
	if envelope.Data != nil {
		t.Errorf("hata cevabinda jeton olmamali: %+v", envelope.Data)
	}
}

func TestOrderRoomTokenRequiresUser(t *testing.T) {
	orders := &fakeOrders{}
	app := roomTokenApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, roomTokenPath(), "",
		map[string]string{IdempotencyKeyHeader: "", fiber.HeaderAuthorization: ""}))

	if status != http.StatusUnauthorized || envelope.Error.Code != apperror.CodeUnauthorized {
		t.Errorf("401 bekleniyordu: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("kimliksiz istekte siparis servisine gidilmemeli")
	}
}

func TestOrderRoomTokenRejectsUnknownQuery(t *testing.T) {
	orders := &fakeOrders{}
	app := roomTokenApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, roomTokenPath()+"?ttl=3600", "", map[string]string{IdempotencyKeyHeader: ""}))

	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed || orders.called {
		t.Errorf("400 ve servise gidilmemesi bekleniyordu: %d %+v %v", status, envelope, orders.called)
	}
}
