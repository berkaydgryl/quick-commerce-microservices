package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

func TestUnknownPathReturnsEnvelope(t *testing.T) {
	// Fiber'in varsayilan duz metin 404'u sozlesmeyi bozardi.
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, Logger: silentLogger()})

	response, err := app.Test(newRequest(t, http.MethodGet, "/yok", nil))
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

	response, err := app.Test(newRequest(t, http.MethodPost, "/healthz", nil))
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

	response, err := app.Test(newRequest(t, http.MethodGet, "/yok", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

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
