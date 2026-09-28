package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

const (
	testShutdownTimeout = 2 * time.Second
	slowHandlerDelay    = 300 * time.Millisecond
	startupWait         = 2 * time.Second
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// freeAddr, isletim sisteminden bos bir port alir ve birakir. serve adres
// aldigi icin port 0 dogrudan verilemez (hangi porta baglandigi bilinemez).
func freeAddr(t *testing.T) string {
	t.Helper()
	var config net.ListenConfig
	listener, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bos port alinamadi: %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("port birakilamadi: %v", err)
	}
	return addr
}

func waitUntilListening(t *testing.T, addr string) {
	t.Helper()
	var dialer net.Dialer
	deadline := time.Now().Add(startupWait)
	for time.Now().Before(deadline) {
		conn, err := dialer.DialContext(t.Context(), "tcp", addr)
		if err == nil {
			if closeErr := conn.Close(); closeErr != nil {
				t.Fatalf("deneme baglantisi kapatilamadi: %v", closeErr)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("sunucu %s icinde dinlemeye baslamadi", startupWait)
}

// fetchResult, test goroutine'i disinda yapilan istegin sonucu.
type fetchResult struct {
	body string
	err  error
}

// fetch, GET istegini yapar ve govdeyi okur. Test goroutine'i disinda calistigi
// icin t.Fatal cagiramaz; hatayi (okuma ve kapatma dahil) sonuca yazar.
func fetch(ctx context.Context, url string) fetchResult {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fetchResult{err: err}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fetchResult{err: err}
	}
	body, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	return fetchResult{body: string(body), err: errors.Join(readErr, closeErr)}
}

func TestServeWaitsForInFlightRequestOnShutdown(t *testing.T) {
	app := fiber.New()
	app.Get("/slow", func(c fiber.Ctx) error {
		time.Sleep(slowHandlerDelay)
		return c.SendString("bitti")
	})

	addr := freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	served := make(chan error, 1)
	go func() { served <- serve(ctx, app, addr, testShutdownTimeout, discardLogger()) }()
	waitUntilListening(t, addr)

	responses := make(chan fetchResult, 1)
	go func() { responses <- fetch(t.Context(), "http://"+addr+"/slow") }()

	// Istek yoldayken kapanis sinyali: istek yarida kesilmemeli.
	time.Sleep(slowHandlerDelay / 3)
	cancel()

	got := <-responses
	if got.err != nil {
		t.Fatalf("devam eden istek kesildi: %v", got.err)
	}
	if got.body != "bitti" {
		t.Errorf("govde = %q, beklenen %q", got.body, "bitti")
	}
	if err := <-served; err != nil {
		t.Errorf("zarif kapanis hatasiz donmeliydi: %v", err)
	}
}

func TestServeWrapsListenErrorWithAddress(t *testing.T) {
	// Port dolu: dinleme hatasi hangi adreste oldugunu soylemeli.
	var config net.ListenConfig
	occupied, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("port alinamadi: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := occupied.Close(); closeErr != nil {
			t.Errorf("dolu port birakilamadi: %v", closeErr)
		}
	})
	addr := occupied.Addr().String()

	err = serve(context.Background(), fiber.New(), addr, testShutdownTimeout, discardLogger())
	if err == nil {
		t.Fatal("dolu portta hata beklenirdi")
	}
	if !strings.Contains(err.Error(), "http sunucusu ("+addr+")") {
		t.Errorf("hata adresi tasimali, gelen: %v", err)
	}
}
