package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

// envMap, testin kendi ortamini verir: gercek os.Getenv kirletilmez.
func envMap(values map[string]string) Getenv {
	return func(name string) string { return values[name] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(envMap(nil))
	if err != nil {
		t.Fatalf("bos ortamda hata beklenmiyordu: %v", err)
	}

	if cfg.Port != defaultPort {
		t.Errorf("port: %d bekleniyordu, %d geldi", defaultPort, cfg.Port)
	}
	if cfg.Addr() != ":8080" {
		t.Errorf("adres: :8080 bekleniyordu, %q geldi", cfg.Addr())
	}
	if cfg.LogLevel != defaultLogLevel {
		t.Errorf("gunluk seviyesi: %v bekleniyordu, %v geldi", defaultLogLevel, cfg.LogLevel)
	}
	if cfg.Mock {
		t.Error("MOCK varsayilani false olmaliydi")
	}
	if len(cfg.Services) != 2 {
		t.Fatalf("iki servis bekleniyordu, %d geldi", len(cfg.Services))
	}
	if cfg.Services[0].Address != defaultCatalogAddress {
		t.Errorf("katalog adresi: %q geldi", cfg.Services[0].Address)
	}
}

func TestLoadReadsValues(t *testing.T) {
	cfg, err := Load(envMap(map[string]string{
		"GATEWAY_PORT":               "9090",
		"LOG_LEVEL":                  "debug",
		"MOCK":                       "true",
		"NODE_ENV":                   "production",
		"CATALOG_GRPC_ADDR":          "catalog:50051",
		"ORDER_GRPC_ADDR":            "order:50053",
		"GRPC_SHUTDOWN_TIMEOUT_MS":   "2500",
		"GATEWAY_REQUEST_TIMEOUT_MS": "750",
	}))
	if err != nil {
		t.Fatalf("gecerli ortamda hata: %v", err)
	}

	if cfg.Port != 9090 || cfg.NodeEnv != "production" || !cfg.Mock {
		t.Errorf("degerler okunamadi: %+v", cfg)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Errorf("debug seviyesi bekleniyordu, %v geldi", cfg.LogLevel)
	}
	if cfg.ShutdownTimeout != 2500*time.Millisecond {
		t.Errorf("kapanis suresi: %v geldi", cfg.ShutdownTimeout)
	}
	if cfg.RequestTimeout != 750*time.Millisecond {
		t.Errorf("istek suresi: %v geldi", cfg.RequestTimeout)
	}
	if cfg.Services[0].Address != "catalog:50051" {
		t.Errorf("konteyner adresi okunamadi: %q", cfg.Services[0].Address)
	}
}

func TestLoadTreatsBlankAsMissing(t *testing.T) {
	// docker-compose'da "GATEWAY_PORT=" yazmak degiskeni bos metin olarak gecirir.
	cfg, err := Load(envMap(map[string]string{"GATEWAY_PORT": "   ", "CATALOG_GRPC_ADDR": ""}))
	if err != nil {
		t.Fatalf("bos deger varsayilana dusmeliydi: %v", err)
	}
	if cfg.Port != defaultPort || cfg.Services[0].Address != defaultCatalogAddress {
		t.Errorf("varsayilanlar uygulanmadi: %+v", cfg)
	}
}

func TestLoadReportsAllProblemsAtOnce(t *testing.T) {
	// Uc sorun birden: gelistirici uc kez yeniden baslatmak zorunda kalmamali.
	_, err := Load(envMap(map[string]string{
		"GATEWAY_PORT": "70000",
		"MOCK":         "belki",
		"LOG_LEVEL":    "sessiz",
	}))
	if err == nil {
		t.Fatal("hata bekleniyordu")
	}

	for _, want := range []string{"GATEWAY_PORT", "MOCK", "LOG_LEVEL"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("hata mesajinda %s gecmeliydi: %v", want, err)
		}
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	cases := map[string]map[string]string{
		"port sayi degil":     {"GATEWAY_PORT": "abc"},
		"port araligin disi":  {"GATEWAY_PORT": "0"},
		"sure negatif":        {"GRPC_SHUTDOWN_TIMEOUT_MS": "-1"},
		"bilinmeyen NODE_ENV": {"NODE_ENV": "staging"},
	}

	for name, env := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Load(envMap(env)); err == nil {
				t.Error("hata bekleniyordu")
			}
		})
	}
}
