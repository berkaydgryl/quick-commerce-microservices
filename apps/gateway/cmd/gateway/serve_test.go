package main

import (
	"context"
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
	listener, err := net.Listen("tcp", "127.0.0.1:0")
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
	deadline := time.Now().Add(startupWait)
	for time.Now().Before(deadline) {
		conn, err := net.Dial("tcp", addr)
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

	type result struct {
		body string
		err  error
	}
	responses := make(chan result, 1)
	go func() {
		response, err := http.Get("http://" + addr + "/slow")
		if err != nil {
			responses <- result{err: err}
			return
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		responses <- result{body: string(body), err: err}
	}()

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
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("port alinamadi: %v", err)
	}
	defer occupied.Close()
	addr := occupied.Addr().String()

	err = serve(context.Background(), fiber.New(), addr, testShutdownTimeout, discardLogger())
	if err == nil {
		t.Fatal("dolu portta hata beklenirdi")
	}
	if !strings.Contains(err.Error(), "http sunucusu ("+addr+")") {
		t.Errorf("hata adresi tasimali, gelen: %v", err)
	}
}
