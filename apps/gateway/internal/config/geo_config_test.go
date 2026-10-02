package config

import (
	"strings"
	"testing"
	"time"
)

func TestGeoDefaults(t *testing.T) {
	cfg, err := Load(minimalEnv(nil))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.GeoBaseURL.String() != "https://nominatim.openstreetmap.org" || cfg.GeoTimeout != 5*time.Second ||
		!strings.HasPrefix(cfg.GeoUserAgent, "getir-demo-gateway/") {
		t.Errorf(".env.example varsayilanlari bekleniyordu: %v %v %q", cfg.GeoBaseURL, cfg.GeoTimeout, cfg.GeoUserAgent)
	}
}

func TestGeoValuesAreRead(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{
		"GEO_BASE_URL": "http://nominatim.internal:8088/yol/", "GEO_USER_AGENT": "deneme/2.0", "GEO_TIMEOUT_MS": "2500",
	}))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.GeoBaseURL.String() != "http://nominatim.internal:8088/yol" || cfg.GeoUserAgent != "deneme/2.0" || cfg.GeoTimeout != 2500*time.Millisecond {
		t.Errorf("degerler okunamadi (sondaki / atilmali): %v %q %v", cfg.GeoBaseURL, cfg.GeoUserAgent, cfg.GeoTimeout)
	}
}

func TestInvalidGeoSettingsAreRejected(t *testing.T) {
	for name, value := range map[string]string{
		"GEO_BASE_URL":   "ftp://nominatim.internal",
		"GEO_TIMEOUT_MS": "uzun",
	} {
		_, err := Load(minimalEnv(map[string]string{name: value}))
		if err == nil || !strings.Contains(err.Error(), name) {
			t.Errorf("%s=%q reddedilmeli: %v", name, value, err)
		}
	}
	for _, value := range []string{"https://nominatim.internal?anahtar=1", "https://nominatim.internal#a", "nominatim.internal"} {
		if _, err := Load(minimalEnv(map[string]string{"GEO_BASE_URL": value})); err == nil {
			t.Errorf("GEO_BASE_URL=%q reddedilmeli", value)
		}
	}
}
