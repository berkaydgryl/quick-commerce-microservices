package config

import (
	"strings"
	"testing"
	"time"
)

func TestMailDefaults(t *testing.T) {
	cfg, err := Load(minimalEnv(nil))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.SMTPAddress != "localhost:1025" || cfg.SMTPTimeout != 5*time.Second ||
		cfg.MailFrom.Address != "no-reply@getir.local" || cfg.MailFrom.Name != "getir" {
		t.Errorf(".env.example varsayilanlari (Mailpit) bekleniyordu: %q %v %+v", cfg.SMTPAddress, cfg.SMTPTimeout, cfg.MailFrom)
	}
}

func TestMailValuesAreRead(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{
		"SMTP_URL": "smtp://mailpit:1025", "MAIL_FROM": "Getir Demo <demo@ornek.com>", "SMTP_TIMEOUT_MS": "2500",
	}))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.SMTPAddress != "mailpit:1025" || cfg.MailFrom.Address != "demo@ornek.com" || cfg.SMTPTimeout != 2500*time.Millisecond {
		t.Errorf("degerler okunamadi: %q %+v %v", cfg.SMTPAddress, cfg.MailFrom, cfg.SMTPTimeout)
	}
}

func TestMockWithoutSMTPKeepsMailInMemory(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{"MOCK": "true"}))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.SMTPAddress != "" {
		t.Errorf("MOCK'ta SMTP_URL yoksa adres bos olmali (bellek): %q", cfg.SMTPAddress)
	}
	cfg, err = Load(minimalEnv(map[string]string{"MOCK": "true", "SMTP_URL": "smtp://localhost:1025"}))
	if err != nil || cfg.SMTPAddress != "localhost:1025" {
		t.Errorf("MOCK'ta verilen SMTP_URL kullanilmali: %q (%v)", cfg.SMTPAddress, err)
	}
}

func TestProductionRequiresSMTPURL(t *testing.T) {
	_, err := Load(minimalEnv(map[string]string{
		"NODE_ENV": "production", "JWT_SECRET": strings.Repeat("j", 40), "REALTIME_TOKEN_SECRET": strings.Repeat("r", 40),
	}))
	if err == nil || !strings.Contains(err.Error(), "SMTP_URL") {
		t.Errorf("production'da SMTP_URL zorunlu olmali: %v", err)
	}
}

func TestInvalidMailSettingsAreRejected(t *testing.T) {
	for _, value := range []string{
		"localhost:1025", "smtps://mail.ornek.com:465", "smtp://kullanici:parola@mail.ornek.com:587",
		"smtp://mail.ornek.com", "smtp://:1025", "smtp://mail.ornek.com:25/yol", "smtp://mail.ornek.com:25?a=1",
	} {
		_, err := Load(minimalEnv(map[string]string{"SMTP_URL": value}))
		if err == nil || !strings.Contains(err.Error(), "SMTP_URL") {
			t.Errorf("SMTP_URL=%q reddedilmeli: %v", value, err)
			continue
		}
		if strings.Contains(err.Error(), "parola") {
			t.Errorf("hata metni degeri tasimamali: %v", err)
		}
	}
	for name, value := range map[string]string{"MAIL_FROM": "adres-degil", "SMTP_TIMEOUT_MS": "uzun"} {
		if _, err := Load(minimalEnv(map[string]string{name: value})); err == nil || !strings.Contains(err.Error(), name) {
			t.Errorf("%s=%q reddedilmeli: %v", name, value, err)
		}
	}
}

func TestPhoneChangeIsDevelopmentOnly(t *testing.T) {
	if !(Config{NodeEnv: EnvDevelopment}).PhoneChangeEnabled() || (Config{NodeEnv: EnvProduction}).PhoneChangeEnabled() {
		t.Error("telefon degistirme yalnizca production disinda acik olmali (#95)")
	}
}
