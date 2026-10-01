package main

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/persona"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func envOf(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestSeedRefusesProductionBeforeConnecting(t *testing.T) {
	// Adres ulasilamaz: production denetimi baglantidan ONCE olmali, yoksa
	// hata "ulasilamadi" olurdu.
	err := run(t.Context(), envOf(map[string]string{
		"NODE_ENV": "production", "GATEWAY_MONGO_URI": "mongodb://127.0.0.1:1/?directConnection=true",
	}), silentLogger())

	if !errors.Is(err, persona.ErrProduction) {
		t.Errorf("production reddedilmeli: %v", err)
	}
}

func TestSeedRequiresMongoURI(t *testing.T) {
	err := run(t.Context(), envOf(map[string]string{}), silentLogger())

	if err == nil || !strings.Contains(err.Error(), "GATEWAY_MONGO_URI") {
		t.Errorf("GATEWAY_MONGO_URI zorunlu olmali: %v", err)
	}
}
