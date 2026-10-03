package config

import (
	"strings"
	"testing"
)

func TestRealtimeTokenSecretIsRead(t *testing.T) {
	cfg, err := Load(minimalEnv(nil))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if string(cfg.RealtimeTokenSecret.Bytes()) != testRealtimeTokenSecret {
		t.Error("oda jetonu sirri oldugu gibi okunmali")
	}
	if cfg.RealtimeTokenSecret.String() != redacted {
		t.Errorf("sir yazdirilinca gizlenmeli: %q", cfg.RealtimeTokenSecret.String())
	}
}

func TestRealtimeTokenSecretRules(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{"yok", map[string]string{"REALTIME_TOKEN_SECRET": ""}, "REALTIME_TOKEN_SECRET: zorunlu"},
		{"bosluk", map[string]string{"REALTIME_TOKEN_SECRET": "   "}, "REALTIME_TOKEN_SECRET: zorunlu"},
		{"kisa", map[string]string{"REALTIME_TOKEN_SECRET": "kisa-oda-sirri"}, "REALTIME_TOKEN_SECRET: en az 32 bayt"},
		{
			"productionda ornek sir",
			map[string]string{"REALTIME_TOKEN_SECRET": exampleRealtimeTokenSecret, "NODE_ENV": EnvProduction},
			"REALTIME_TOKEN_SECRET: production'da .env.example'daki ornek sir",
		},
		{
			"JWT_SECRET ile ayni",
			map[string]string{"REALTIME_TOKEN_SECRET": testJWTSecret},
			"REALTIME_TOKEN_SECRET: JWT_SECRET ile ayni olamaz",
		},
		{
			"bosluklu ama JWT_SECRET ile ayni",
			map[string]string{"REALTIME_TOKEN_SECRET": "  " + testJWTSecret + "  "},
			"JWT_SECRET ile ayni olamaz",
		},
		{
			// MOCK sirri gevsetmez: jeton sahte modda da gercek imzayla uretilir.
			"MOCK'ta da zorunlu",
			map[string]string{"REALTIME_TOKEN_SECRET": "", "MOCK": "true"},
			"REALTIME_TOKEN_SECRET: zorunlu",
		},
	}
	for _, tc := range cases {
		_, err := Load(minimalEnv(tc.env))
		if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
			t.Errorf("%s: %q iceren hata bekleniyordu, %v geldi", tc.name, tc.wantErr, err)
		}
	}
}

func TestRealtimeExampleSecretIsAllowedOutsideProduction(t *testing.T) {
	// Yerel gelistirme: .env.example kopyalanip calistirilabilsin.
	if _, err := Load(minimalEnv(map[string]string{"REALTIME_TOKEN_SECRET": exampleRealtimeTokenSecret})); err != nil {
		t.Errorf("gelistirmede ornek sir kabul edilmeli: %v", err)
	}
}

func TestRealtimeTokenSecretNeverInError(t *testing.T) {
	const secret = "kisa-ama-gizli-oda"
	_, err := Load(minimalEnv(map[string]string{"REALTIME_TOKEN_SECRET": secret}))
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Errorf("hata sirri icermemeli: %v", err)
	}
}
