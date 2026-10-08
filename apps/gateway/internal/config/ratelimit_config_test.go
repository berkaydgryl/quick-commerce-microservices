package config

import (
	"strings"
	"testing"
	"time"
)

func TestRateLimitDefaults(t *testing.T) {
	cfg, err := Load(minimalEnv(nil))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if !cfg.RateLimitEnabled || cfg.RateLimitWindow != time.Minute ||
		cfg.RateLimitGeneral != 120 || cfg.RateLimitAuth != 10 || cfg.RateLimitOrder != 20 {
		t.Errorf(".env.example varsayilanlari bekleniyordu: %+v", cfg)
	}
	if cfg.ThreeDSIPLimitEnabled {
		t.Error("3DS IP penceresi varsayilan KAPALI olmali (G1: vekil arkasinda kuresel kilit)")
	}
}

func TestThreeDSIPLimitIsRead(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{"THREEDS_IP_LIMIT_ENABLED": "true"}))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if !cfg.ThreeDSIPLimitEnabled {
		t.Error("THREEDS_IP_LIMIT_ENABLED=true okunmadi")
	}
}

func TestRateLimitValuesAreRead(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{
		"RATE_LIMIT_ENABLED": "false", "RATE_LIMIT_WINDOW_SECONDS": "10",
		"RATE_LIMIT_MAX_REQUESTS": "6", "RATE_LIMIT_AUTH_MAX_REQUESTS": "4", "RATE_LIMIT_ORDER_MAX_REQUESTS": "3",
	}))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.RateLimitEnabled || cfg.RateLimitWindow != 10*time.Second ||
		cfg.RateLimitGeneral != 6 || cfg.RateLimitAuth != 4 || cfg.RateLimitOrder != 3 {
		t.Errorf("degerler okunamadi: %+v", cfg)
	}
}

func TestInvalidRateLimitsAreReportedTogether(t *testing.T) {
	// Sifir ya da negatif sinir "sinirsiz" diye yorumlanmaz; ust sinir sayacin
	// Redis'teki boyutunu sinirlar. Butun sorunlar tek hatada.
	_, err := Load(minimalEnv(map[string]string{
		"RATE_LIMIT_ENABLED": "belki", "RATE_LIMIT_WINDOW_SECONDS": "0",
		"RATE_LIMIT_MAX_REQUESTS": "0", "RATE_LIMIT_AUTH_MAX_REQUESTS": "-1", "RATE_LIMIT_ORDER_MAX_REQUESTS": "10001",
		"THREEDS_IP_LIMIT_ENABLED": "belki",
	}))
	if err == nil {
		t.Fatal("gecersiz degerler reddedilmeliydi")
	}
	for _, name := range []string{"RATE_LIMIT_ENABLED", "RATE_LIMIT_WINDOW_SECONDS", "RATE_LIMIT_MAX_REQUESTS", "RATE_LIMIT_AUTH_MAX_REQUESTS", "RATE_LIMIT_ORDER_MAX_REQUESTS", "THREEDS_IP_LIMIT_ENABLED"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("%s hatada yok: %v", name, err)
		}
	}
}
