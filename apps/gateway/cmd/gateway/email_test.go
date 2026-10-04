package main

import (
	"bytes"
	"net/mail"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	internalmail "github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
)

func TestBuildMailerFollowsSMTPAddress(t *testing.T) {
	// MOCK'ta SMTP_URL yoksa adres bos gelir (config): ileti bellekte kalir.
	memory, err := buildMailer(config.Config{})
	if _, ok := memory.(*internalmail.Memory); err != nil || !ok {
		t.Errorf("adres yoksa bellek kutusu bekleniyordu: %T (%v)", memory, err)
	}
	smtp, err := buildMailer(config.Config{
		SMTPAddress: "localhost:1025", MailFrom: mail.Address{Address: "no-reply@getir.local"}, SMTPTimeout: time.Second,
	})
	if _, ok := smtp.(*internalmail.SMTP); err != nil || !ok {
		t.Errorf("adres varsa SMTP bekleniyordu: %T (%v)", smtp, err)
	}
}

func TestDerivedKeysDifferPerLabel(t *testing.T) {
	// Kod ozetinin anahtari parmak izi anahtarindan ayridir: biri digerinin
	// yerine kullanilamaz.
	secret := []byte("en-az-32-bayt-uzunlugunda-bir-test-sirri")
	if bytes.Equal(derivedKey(secret, emailCodeKeyLabel), fingerprintKey(secret)) {
		t.Error("etiketler ayri anahtar uretmeli")
	}
	if !bytes.Equal(derivedKey(secret, emailCodeKeyLabel), derivedKey(secret, emailCodeKeyLabel)) {
		t.Error("ayni sir ve etiket ayni anahtari uretmeli (ornekler arasi ortak)")
	}
}
