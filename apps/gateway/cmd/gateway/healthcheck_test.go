package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

// statusServer, her istege verilen kodla cevap veren yerel sunucu.
func statusServer(t *testing.T, status int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)
	return server
}

// portOf, sunucunun portunu doner: runHealthcheck adres degil port alir.
func portOf(t *testing.T, server *httptest.Server) int {
	t.Helper()
	_, portText, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatalf("adres ayrilamadi: %v", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("port sayi degil: %v", err)
	}
	return port
}

func TestHealthcheckExitCodeFollowsStatus(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   int
	}{
		{"hepsi ayakta", http.StatusOK, exitHealthy},
		// 503: bagimli servis dusuk; orkestrator gateway'i trafikten cekmeli.
		{"bagimli servis dusuk", http.StatusServiceUnavailable, exitUnhealthy},
	}
	for _, tc := range cases {
		server := statusServer(t, tc.status)

		if got := runHealthcheck(t.Context(), portOf(t, server)); got != tc.want {
			t.Errorf("%s: cikis kodu %d, beklenen %d", tc.name, got, tc.want)
		}
	}
}

func TestHealthcheckUnreachableIsUnhealthy(t *testing.T) {
	server := statusServer(t, http.StatusOK)
	port := portOf(t, server)
	server.Close()

	if got := runHealthcheck(t.Context(), port); got != exitUnhealthy {
		t.Errorf("kapali portta cikis kodu %d, beklenen %d", got, exitUnhealthy)
	}
}

func TestHealthcheckHonorsContext(t *testing.T) {
	// D8: istek baglama baglidir; iptal edilmis baglamla probe beklemeden
	// "saglikli degil" der. Baglamsiz istekte bu test gecmezdi (sunucu 200 doner).
	server := statusServer(t, http.StatusOK)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	if got := runHealthcheck(ctx, portOf(t, server)); got != exitUnhealthy {
		t.Errorf("iptal edilmis baglamda cikis kodu %d, beklenen %d", got, exitUnhealthy)
	}
}
