package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Numara kontrolu (T11.7): karsilama ekraninin pencereleri numara yazilinca
// erken uyarir. Bilincli odunlesim: cevap numaranin kayitli olup olmadigini
// soyler; uc IP basina sinirlidir (ratelimit testleri) ve numara gunluge girmez.

func phoneCheckRequest(t *testing.T, phone string) *http.Request {
	t.Helper()
	return jsonRequest(t, http.MethodPost, "/v1/auth/phone-check", marshal(map[string]string{"phone": phone}), nil)
}

func TestPhoneCheckTellsWhetherPhoneIsRegistered(t *testing.T) {
	app := authApp(t, silentLogger())

	status, header, envelope := exchange(t, app, phoneCheckRequest(t, testPhone))
	if status != http.StatusOK || dataOf[phoneCheckResult](t, envelope).Registered {
		t.Fatalf("kayitsiz numara: 200 ve registered false bekleniyordu: %d %+v", status, envelope)
	}
	if got := header.Get(fiber.HeaderCacheControl); got != noStore {
		t.Errorf("cevap onbelleklenmemeli: %q", got)
	}

	send(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))

	status, _, envelope = exchange(t, app, phoneCheckRequest(t, testPhone))
	if status != http.StatusOK || !dataOf[phoneCheckResult](t, envelope).Registered {
		t.Errorf("kayitli numara: registered true bekleniyordu: %d %+v", status, envelope)
	}
}

func TestPhoneCheckValidatesFormatWithoutIdempotencyKey(t *testing.T) {
	// Kalici bir sey degistirmez: anahtar istemez; bicimsiz numara sozlesmenin
	// cumlesiyle alanin altina doner.
	app := authApp(t, silentLogger())

	status, envelope := send(t, app, phoneCheckRequest(t, "05321234567"))

	details := detailsOf(t, envelope)
	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed || details[auth.FieldPhone] == nil {
		t.Fatalf("400 VALIDATION_FAILED ve phone ayrintisi bekleniyordu: %d %+v", status, envelope)
	}
	if details[IdempotencyKeyHeader] != nil {
		t.Errorf("numara kontrolu anahtar istememeli: %+v", details)
	}
}

func TestPhoneCheckRejectsUnknownFieldAndQuery(t *testing.T) {
	app := authApp(t, silentLogger())

	body := `{"phone":"` + testPhone + `","password":"x"}`
	status, envelope := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/phone-check", body, nil))
	if status != http.StatusBadRequest || detailsOf(t, envelope)["password"] != unknownFieldReason {
		t.Errorf("bilinmeyen alan 400 donmeli: %d %+v", status, envelope)
	}

	request := jsonRequest(t, http.MethodPost, "/v1/auth/phone-check?phone="+testPhone, marshal(map[string]string{"phone": testPhone}), nil)
	if status, _ := send(t, app, request); status != http.StatusBadRequest {
		t.Errorf("numara adreste tasinmamali (sorgu parametresi 400): %d", status)
	}
}

func TestPhoneCheckKeepsPhoneOutOfLog(t *testing.T) {
	var logs bytes.Buffer
	app := authApp(t, slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))

	send(t, app, phoneCheckRequest(t, testPhone))
	send(t, app, phoneCheckRequest(t, "05321234567"))

	if !strings.Contains(logs.String(), "/v1/auth/phone-check") {
		t.Fatalf("istek gunluge dusmeliydi: %s", logs.String())
	}
	for _, phone := range []string{testPhone, "05321234567", "5321234567"} {
		if strings.Contains(logs.String(), phone) {
			t.Errorf("numara gunluge sizdi (%s): %s", phone, logs.String())
		}
	}
}

func TestPhoneCheckHasTheTighterAuthLimitOfItsOwn(t *testing.T) {
	// Numara taramasini yavaslatan sinir: kimlik siniri (IP basina). Sayac
	// rota basinadir: numara kontrolu girisin hakkini yemez.
	clock := newTestClock()
	app := limitedApp(t, memoryLimits(clock, 10, 2, 10), &fakeOrders{}, silentLogger())
	check := func() int {
		status, _ := send(t, app, phoneCheckRequest(t, testPhone))
		return status
	}

	if first, second := check(), check(); first != http.StatusOK || second != http.StatusOK {
		t.Fatalf("ilk iki kontrol 200 almali: %d %d", first, second)
	}
	if status := check(); status != http.StatusTooManyRequests {
		t.Errorf("ucuncu kontrol 429 almali: %d", status)
	}
	status, _ := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil))
	if status == http.StatusTooManyRequests {
		t.Errorf("giris kendi sayacinda, numara kontrolunden etkilenmemeli: %d", status)
	}
}
