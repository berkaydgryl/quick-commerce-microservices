package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
)

// fakeReporter, gercek gRPC baglantisi olmadan rapor doner.
type fakeReporter struct {
	report health.Report
}

func (f fakeReporter) Check(context.Context) health.Report { return f.report }

// silentLogger, test ciktisini kirletmeyen gunlukcu.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func healthyReport() health.Report {
	return health.Report{
		Status: health.ReportOK,
		Services: []health.ServiceStatus{
			{Name: "catalog", Status: health.StatusServing, LatencyMs: 2},
			{Name: "order", Status: health.StatusServing, LatencyMs: 3},
		},
	}
}

func degradedReport() health.Report {
	return health.Report{
		Status: health.ReportDegraded,
		Services: []health.ServiceStatus{
			{Name: "catalog", Status: health.StatusServing, LatencyMs: 2},
			{Name: "order", Status: health.StatusUnreachable, Error: "Unavailable"},
		},
	}
}

func decode(t *testing.T, response *http.Response) Envelope {
	t.Helper()
	defer func() { _ = response.Body.Close() }()

	var envelope Envelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("cevap cozulemedi: %v", err)
	}
	return envelope
}

func TestHealthzReturnsOKWhenAllServing(t *testing.T) {
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, Logger: silentLogger()})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusOK {
		t.Errorf("200 bekleniyordu, %d geldi", response.StatusCode)
	}

	envelope := decode(t, response)
	if !envelope.Success {
		t.Errorf("success true bekleniyordu: %+v", envelope)
	}
}

func TestHealthzReturns503WhenDegraded(t *testing.T) {
	// Probe govdeyi degil KODU okur; bagimli servis dustugunde gateway hazir
	// sayilmamali.
	app := New(Deps{Health: fakeReporter{report: degradedReport()}, Logger: silentLogger()})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("503 bekleniyordu, %d geldi", response.StatusCode)
	}

	envelope := decode(t, response)
	if envelope.Success || envelope.Error == nil {
		t.Fatalf("hata zarfi bekleniyordu: %+v", envelope)
	}
	if envelope.Error.Code != "SERVICE_UNAVAILABLE" {
		t.Errorf("kod: %q geldi", envelope.Error.Code)
	}
	if envelope.Error.RequestID == "" {
		t.Error("requestId dolu olmaliydi (gunlukle eslesmeli)")
	}
}

func TestRequestIDHeaderIsPropagated(t *testing.T) {
	// Gateway'e gelen kimlik korunur; uretilmez. Uctan uca iz boylece kopmaz.
	app := New(Deps{Health: fakeReporter{report: degradedReport()}, Logger: silentLogger()})

	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	request.Header.Set(RequestIDHeader, "req_disaridan")

	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if got := decode(t, response).Error.RequestID; got != "req_disaridan" {
		t.Errorf("gelen requestId korunmaliydi, %q geldi", got)
	}
}

func TestUnknownPathReturnsEnvelope(t *testing.T) {
	// Fiber'in varsayilan duz metin 404'u sozlesmeyi bozardi.
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, Logger: silentLogger()})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/yok", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusNotFound {
		t.Errorf("404 bekleniyordu, %d geldi", response.StatusCode)
	}
	envelope := decode(t, response)
	if envelope.Success || envelope.Error.Code != "NOT_FOUND" {
		t.Errorf("NOT_FOUND zarfi bekleniyordu: %+v", envelope)
	}
}

func TestWrongMethodMapsToErrorTable(t *testing.T) {
	// Sozlukte METHOD_NOT_ALLOWED yok; "405 + INTERNAL" istemciyi yaniltirdi.
	// Cevap kodu, secilen hata kodunun tablodaki karsiligi olmali.
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, Logger: silentLogger()})

	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/healthz", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusNotFound {
		t.Errorf("404 bekleniyordu, %d geldi", response.StatusCode)
	}
	if code := decode(t, response).Error.Code; code != "NOT_FOUND" {
		t.Errorf("NOT_FOUND bekleniyordu, %q geldi", code)
	}
}

func TestClassifyMapsToErrorTable(t *testing.T) {
	cases := []struct {
		raw        int
		wantCode   apperror.Code
		wantStatus int
	}{
		{http.StatusNotFound, apperror.CodeNotFound, http.StatusNotFound},
		{http.StatusMethodNotAllowed, apperror.CodeNotFound, http.StatusNotFound},
		{http.StatusRequestHeaderFieldsTooLarge, apperror.CodeValidationFailed, http.StatusBadRequest},
		{http.StatusBadRequest, apperror.CodeValidationFailed, http.StatusBadRequest},
		{http.StatusInternalServerError, apperror.CodeInternal, http.StatusInternalServerError},
		{http.StatusBadGateway, apperror.CodeInternal, http.StatusInternalServerError},
	}

	for _, tc := range cases {
		got := classify(tc.raw)
		// Cevap kodu tablodan gelir; classify yalnizca sozluk kodunu secer.
		if got != tc.wantCode || apperror.HTTPStatus(got) != tc.wantStatus {
			t.Errorf("%d: %s/%d bekleniyordu, %s/%d geldi", tc.raw, tc.wantCode, tc.wantStatus, got, apperror.HTTPStatus(got))
		}
	}
}

func TestRequestLogRecordsFinalStatus(t *testing.T) {
	// Hata ErrorHandler'da cevaplanmadan once gunluk yazilirsa 404 donen istek
	// logda 200 gorunur; operasyon yanlis veriye bakar.
	var buffer bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buffer, nil))
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, Logger: logger})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/yok", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	_ = response.Body.Close()

	for _, line := range strings.Split(strings.TrimSpace(buffer.String()), "\n") {
		var entry struct {
			Msg    string `json:"msg"`
			Status int    `json:"status"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("gunluk satiri JSON degil: %q", line)
		}
		if entry.Msg == "http istegi" {
			if entry.Status != http.StatusNotFound {
				t.Errorf("gunlukte 404 bekleniyordu, %d yazildi", entry.Status)
			}
			return
		}
	}
	t.Fatal("http istegi gunluk satiri bulunamadi")
}
