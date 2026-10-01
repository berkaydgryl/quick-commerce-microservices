package metrics_test

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/metrics"
)

func discard() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func listen(t *testing.T) *metrics.Server {
	t.Helper()
	server, err := metrics.Listen(t.Context(), "127.0.0.1:0", metrics.New().Handler(), discard())
	if err != nil {
		t.Fatalf("uc acilamadi: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := server.Close(context.WithoutCancel(t.Context())); closeErr != nil {
			t.Errorf("uc kapatilamadi: %v", closeErr)
		}
	})
	return server
}

// call, istegi gonderir; govdeyi okuyup kapatir, durum ve basliklari doner.
// (bodyclose yalnizca cevabi alan fonksiyonun kendi govdesindeki Close'u gorur.)
func call(t *testing.T, method, url string) (int, http.Header) {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), method, url, nil)
	if err != nil {
		t.Fatalf("istek kurulamadi: %v", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	_, readErr := io.Copy(io.Discard, response.Body)
	closeErr := response.Body.Close()
	if readErr != nil || closeErr != nil {
		t.Fatalf("govde okunamadi ya da kapatilamadi: %v %v", readErr, closeErr)
	}
	return response.StatusCode, response.Header
}

func TestEndpointServesOnlyGetMetrics(t *testing.T) {
	base := "http://" + listen(t).Addr()

	status, header := call(t, http.MethodGet, base+metrics.Path)
	if status != http.StatusOK || !strings.HasPrefix(header.Get("Content-Type"), "text/plain") {
		t.Errorf("GET /metrics 200 ve metin bicimi bekleniyordu: %d %q", status, header.Get("Content-Type"))
	}
	if status, _ = call(t, http.MethodGet, base+"/"); status != http.StatusNotFound {
		t.Errorf("baska yol 404 bekleniyordu: %d", status)
	}
	status, header = call(t, http.MethodPost, base+metrics.Path)
	if status != http.StatusMethodNotAllowed || header.Get("Allow") != http.MethodGet {
		t.Errorf("POST 405 ve Allow: GET bekleniyordu: %d %q", status, header.Get("Allow"))
	}
}

func TestCloseStopsAcceptingConnections(t *testing.T) {
	server, err := metrics.Listen(t.Context(), "127.0.0.1:0", metrics.New().Handler(), discard())
	if err != nil {
		t.Fatalf("uc acilamadi: %v", err)
	}
	addr := server.Addr()

	if err := server.Close(t.Context()); err != nil {
		t.Fatalf("kapanis hatali: %v", err)
	}

	dialer := net.Dialer{Timeout: time.Second}
	if conn, dialErr := dialer.DialContext(t.Context(), "tcp", addr); dialErr == nil {
		if closeErr := conn.Close(); closeErr != nil {
			t.Errorf("baglanti kapatilamadi: %v", closeErr)
		}
		t.Error("kapanistan sonra baglanti kabul edilmemeli")
	}
}

func TestBusyPortFailsToListen(t *testing.T) {
	first := listen(t)

	if _, err := metrics.Listen(t.Context(), first.Addr(), metrics.New().Handler(), discard()); err == nil ||
		!strings.Contains(err.Error(), "metrik portu acilamadi") {
		t.Errorf("dolu port acilisi durdurmali: %v", err)
	}
}
