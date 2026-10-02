package config

import (
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestAuthDefaults(t *testing.T) {
	cfg, err := Load(minimalEnv(nil))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.JWTTTL != time.Hour || cfg.RefreshTTL != 14*24*time.Hour {
		t.Errorf("sureler .env.example varsayilanlari olmali: %v %v", cfg.JWTTTL, cfg.RefreshTTL)
	}
	if cfg.MongoURI != testMongoURI || cfg.MongoDB != "getir_gateway" || cfg.MongoServerSelectionTimeout != 5*time.Second {
		t.Errorf("mongo ayarlari: %q %q %v", cfg.MongoURI, cfg.MongoDB, cfg.MongoServerSelectionTimeout)
	}
	if string(cfg.JWTSecret.Bytes()) != testJWTSecret {
		t.Error("sir oldugu gibi okunmali")
	}
}

func TestAuthValuesAreRead(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{"JWT_TTL": "900", "REFRESH_TTL": "86400", "GATEWAY_MONGO_DB": "getir_test"}))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.JWTTTL != 15*time.Minute || cfg.RefreshTTL != 24*time.Hour || cfg.MongoDB != "getir_test" {
		t.Errorf("degerler okunamadi: %v %v %q", cfg.JWTTTL, cfg.RefreshTTL, cfg.MongoDB)
	}
}

func TestJWTSecretRules(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{"yok", map[string]string{"JWT_SECRET": ""}, "JWT_SECRET: zorunlu"},
		{"kisa", map[string]string{"JWT_SECRET": "kisa-sir"}, "en az 32 bayt"},
		{
			"productionda ornek sir",
			map[string]string{"JWT_SECRET": exampleJWTSecret, "NODE_ENV": EnvProduction},
			"ornek sir kullanilamaz",
		},
	}
	for _, tc := range cases {
		_, err := Load(minimalEnv(tc.env))
		if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
			t.Errorf("%s: %q iceren hata bekleniyordu, %v geldi", tc.name, tc.wantErr, err)
		}
	}
}

func TestExampleSecretIsAllowedOutsideProduction(t *testing.T) {
	// Yerel gelistirmede .env.example kopyalanip calistirilabilsin.
	if _, err := Load(minimalEnv(map[string]string{"JWT_SECRET": exampleJWTSecret})); err != nil {
		t.Errorf("gelistirmede ornek sir kabul edilmeli: %v", err)
	}
}

func TestMongoURIRequiredOutsideMock(t *testing.T) {
	if _, err := Load(minimalEnv(map[string]string{"GATEWAY_MONGO_URI": ""})); err == nil || !strings.Contains(err.Error(), "GATEWAY_MONGO_URI") {
		t.Errorf("MOCK disinda GATEWAY_MONGO_URI zorunlu olmali: %v", err)
	}
	cfg, err := Load(minimalEnv(map[string]string{"GATEWAY_MONGO_URI": "", "MOCK": "true"}))
	if err != nil || cfg.MongoURI != "" {
		t.Errorf("MOCK'ta Mongo'suz acilis kabul edilmeli: %v", err)
	}
}

func TestSharedMongoVariablesAreNotRead(t *testing.T) {
	// D14: her servisin kendi kullanicisi var. D14 oncesi .env'deki ortak
	// MONGO_URI / MONGO_DB okunursa gateway baska bir kullaniciyla ya da ortak
	// veritabanina sessizce baglanirdi; acilis durmali.
	env := map[string]string{"GATEWAY_MONGO_URI": "", "MONGO_URI": testMongoURI, "MONGO_DB": "getir"}
	if _, err := Load(minimalEnv(env)); err == nil || !strings.Contains(err.Error(), "GATEWAY_MONGO_URI") {
		t.Errorf("ortak MONGO_URI kabul edilmemeli: %v", err)
	}
	cfg, err := Load(minimalEnv(map[string]string{"MONGO_DB": "getir"}))
	if err != nil || cfg.MongoDB != "getir_gateway" {
		t.Errorf("ortak MONGO_DB okunmamali: %q %v", cfg.MongoDB, err)
	}
}

func TestInvalidTTLsAreReported(t *testing.T) {
	_, err := Load(minimalEnv(map[string]string{"JWT_TTL": "bir-saat", "REFRESH_TTL": "0"}))
	if err == nil || !strings.Contains(err.Error(), "JWT_TTL") || !strings.Contains(err.Error(), "REFRESH_TTL") {
		t.Errorf("iki gecersiz sure birlikte raporlanmali: %v", err)
	}
}

func TestSecretIsRedactedInOutput(t *testing.T) {
	// Sir yanlislikla gunluge ya da hata metnine yazilsa bile gorunmemeli.
	secret := Secret(testJWTSecret)
	for _, out := range []string{
		fmt.Sprintf("%v", secret), fmt.Sprintf("%s", secret), fmt.Sprintf("%x", secret),
		fmt.Sprintf("%+v", struct{ S Secret }{secret}),
	} {
		if strings.Contains(out, testJWTSecret) || strings.Contains(out, fmt.Sprintf("%x", []byte(testJWTSecret))) {
			t.Errorf("sir ciktida gorundu: %q", out)
		}
	}
	var logged strings.Builder
	slog.New(slog.NewJSONHandler(&logged, nil)).Info("deneme", slog.Any("sir", secret))
	if strings.Contains(logged.String(), testJWTSecret) || !strings.Contains(logged.String(), redacted) {
		t.Errorf("slog siri gizlemeli: %s", logged.String())
	}
	if _, err := Load(minimalEnv(map[string]string{"JWT_SECRET": "kisa-ama-gizli"})); err != nil && strings.Contains(err.Error(), "kisa-ama-gizli") {
		t.Errorf("hata metni sirri icermemeli: %v", err)
	}
}

func TestDemoPasswordResetIsClosedInProduction(t *testing.T) {
	// T11.9: kodsuz sifre yenileme canli ortama cikmaz.
	for env, open := range map[string]bool{EnvDevelopment: true, EnvTest: true, EnvProduction: false} {
		cfg := Config{NodeEnv: env}
		if cfg.DemoPasswordReset() != open {
			t.Errorf("%s: demo sifre yenileme %v olmali", env, open)
		}
	}
}
