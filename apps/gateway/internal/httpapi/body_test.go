package httpapi

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

func TestReserveRejectsBodyFormatErrors(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		headers map[string]string
		field   string
		reason  string
	}{
		{
			name:   "bilinmeyen alan (adres etiketi sozlesmede yok)",
			body:   strings.Replace(validReserveBody, `"line":"Kadikoy"`, `"title":"Ev","line":"Kadikoy"`, 1),
			field:  "title",
			reason: unknownFieldReason,
		},
		{name: "bozuk JSON", body: `{bozuk`, field: bodyField, reason: invalidJSONReason},
		{name: "bos govde", body: ``, field: bodyField, reason: requiredReason},
		{name: "iki JSON degeri", body: validReserveBody + `{}`, field: bodyField, reason: singleValueReason},
		{
			name:    "JSON olmayan icerik",
			body:    validReserveBody,
			headers: map[string]string{fiber.HeaderContentType: "text/plain"},
			field:   contentTypeField,
			reason:  jsonContentReason,
		},
		{
			name:   "konumda boylam yok (0 degil, YOK)",
			body:   strings.Replace(validReserveBody, `"location":{"lat":40.99,"lng":29.02}`, `"location":{"lat":40.99}`, 1),
			field:  "address.location.lng",
			reason: requiredReason,
		},
		{
			name:   "tutarda kurus yok",
			body:   strings.Replace(validReserveBody, `"amountMinor":19360,`, ``, 1),
			field:  "expectedTotal.amountMinor",
			reason: requiredReason,
		},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders)

		status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", tc.body, tc.headers))

		if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed {
			t.Errorf("%s: 400 VALIDATION_FAILED bekleniyordu: %d %+v", tc.name, status, envelope)
			continue
		}
		if got := detailsOf(t, envelope)[tc.field]; got != tc.reason {
			t.Errorf("%s: details[%s] = %v, %q bekleniyordu (%+v)", tc.name, tc.field, got, tc.reason, envelope.Error.Details)
		}
		if orders.called {
			t.Errorf("%s: bicimsiz govdede servis cagrilmamaliydi", tc.name)
		}
	}
}

func TestReserveReportsWrongTypeWithFieldName(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)
	body := strings.Replace(validReserveBody, `"quantity":2`, `"quantity":"iki"`, 1)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", body, nil))

	details := detailsOf(t, envelope)
	found := false
	for field, reason := range details {
		if strings.Contains(field, "quantity") && reason == integerReason {
			found = true
		}
	}
	if status != http.StatusBadRequest || !found {
		t.Errorf("adet alani 'tam sayi olmali' ile donmeli: %d %+v", status, details)
	}
}

// ioDeadline, gercek dinleyicili testte baglantinin en uzun bekleyisi: sunucu
// cevap vermezse test takilmak yerine zaman asimiyla duser.
const ioDeadline = 5 * time.Second

// serveOnLoopback, uygulamayi gercek bir TCP dinleyicide calistirir ve adresini
// dondurur; test bitince sunucu kapatilir ve durmasi beklenir.
func serveOnLoopback(t *testing.T, app *fiber.App) string {
	t.Helper()
	var config net.ListenConfig
	listener, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("dinleyici acilamadi: %v", err)
	}
	served := make(chan error, 1)
	go func() { served <- app.Listener(listener, fiber.ListenConfig{DisableStartupMessage: true}) }()
	t.Cleanup(func() {
		if shutdownErr := app.Shutdown(); shutdownErr != nil {
			t.Errorf("sunucu kapanmadi: %v", shutdownErr)
		}
		if serveErr := <-served; serveErr != nil {
			t.Errorf("sunucu hatayla durdu: %v", serveErr)
		}
	})
	return listener.Addr().String()
}

func TestOversizedBodyIsRejected(t *testing.T) {
	// app.Test sinir ustu govdeyi sunucuya ulastirmadan kendisi reddeder; asil
	// davranis (fasthttp ErrBodyTooLarge -> Fiber 413 -> bizim zarfimiz) GERCEK
	// dinleyicide gorulur.
	//
	// GOVDE BILEREK GONDERILMIYOR: sinir govde okunmadan Content-Length'ten
	// uygulanir. Govde gitseydi sunucu cevabi yazip baglantiyi okunmamis veriyle
	// kapatir, Linux RST yollar ve istemci cevabi okuyamadan "connection reset
	// by peer" alabilirdi (T7.5'te CI boyle dustu; Linux'ta 300 kosuda 8-11 kez).
	// Yalnizca baslik gidince sunucuda okunmamis bayt kalmaz, cevap her seferinde okunur.
	orders := &fakeOrders{}
	app := orderApp(orders)
	dialer := net.Dialer{Timeout: ioDeadline}
	conn, err := dialer.DialContext(t.Context(), "tcp", serveOnLoopback(t, app))
	if err != nil {
		t.Fatalf("baglanilamadi: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := conn.Close(); closeErr != nil {
			t.Errorf("baglanti kapatilamadi: %v", closeErr)
		}
	})
	if err = conn.SetDeadline(time.Now().Add(ioDeadline)); err != nil {
		t.Fatalf("son tarih konamadi: %v", err)
	}

	head := "POST /v1/cart/reserve HTTP/1.1\r\n" +
		"Host: gateway\r\n" +
		fiber.HeaderContentType + ": " + fiber.MIMEApplicationJSON + "\r\n" +
		fiber.HeaderAuthorization + ": " + bearer(t) + "\r\n" +
		IdempotencyKeyHeader + ": anahtar-0001\r\n" +
		fiber.HeaderContentLength + ": " + strconv.Itoa(maxBodyBytes+1) + "\r\n\r\n"
	if _, err = io.WriteString(conn, head); err != nil {
		t.Fatalf("istek yazilamadi: %v", err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("cevap okunamadi: %v", err)
	}
	status, envelope := response.StatusCode, decode(t, response)

	if status != http.StatusBadRequest || envelope.Error == nil || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Fatalf("sinir ustu govde 400 VALIDATION_FAILED donmeli: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("sinir ustu govde servise gitmemeliydi")
	}
	// Istek ara katmana ulasmadan dustu; kimlik yine uretilmeli ve cevap
	// basligiyla ayni olmali (D8), yoksa bu hata gunlukte bulunamazdi.
	if got := envelope.Error.RequestID; !validRequestID(got) || got != response.Header.Get(RequestIDHeader) {
		t.Errorf("hata zarfinda bicimli ve baslikla ayni requestId bekleniyordu: %q (baslik %q)", got, response.Header.Get(RequestIDHeader))
	}
}
