package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/sms"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// emailCodeKeyLabel, dogrulama kodu ozetinin anahtarinin JWT sirrindan
// turetilme etiketi (parmak izi anahtariyla ayni yontem, ayri etiket: anahtar
// jeton imzalayamaz, parmak izi uretemez).
const emailCodeKeyLabel = "getir-gateway/email-code/v1"

// phoneCodeKeyLabel, telefon kodu ozetinin anahtar etiketi (T11.14 PR 3):
// e-postanin anahtarindan ayri.
const phoneCodeKeyLabel = "getir-gateway/phone-code/v1"

// buildEmailVerification, e-posta dogrulamasini kurar (T11.14).
//
//	ileti: buildMailer (SMTP ya da MOCK'ta bellek)
//	depo:  Redis istemcisi varsa Redis; yoksa (MOCK) bellek
func buildEmailVerification(cfg config.Config, client *redis.Client, accounts emailverify.Accounts, mailer emailverify.Mailer) *emailverify.Service {
	return emailverify.NewService(emailverify.Deps{
		Accounts: accounts,
		Store:    buildVerificationStore(client, verification.ChannelEmail),
		Mailer:   mailer,
		CodeKey:  derivedKey(cfg.JWTSecret.Bytes(), emailCodeKeyLabel),
		Now:      time.Now,
	})
}

// buildPhoneVerification, telefon degistirme ve dogrulamayi kurar (T11.14 PR 3).
// Production'da nil: uclar baglanmaz (gercek SMS saglayicisi yok, #95).
// Gelistirmede SMS e-posta gondericisiyle Mailpit'e duser (sms.Mailbox).
func buildPhoneVerification(cfg config.Config, client *redis.Client, identity authParts, mailer emailverify.Mailer) *phoneverify.Service {
	if !cfg.PhoneChangeEnabled() {
		return nil
	}
	return phoneverify.NewService(phoneverify.Deps{
		Accounts:  identity.phoneAccounts,
		Sessions:  identity.sessions,
		Passwords: identity.passwords,
		Store:     buildVerificationStore(client, verification.ChannelPhone),
		SMS:       sms.NewMailbox(mailer),
		CodeKey:   derivedKey(cfg.JWTSecret.Bytes(), phoneCodeKeyLabel),
		Now:       time.Now,
	})
}

// buildVerificationStore, bir kanalin bekleyen kod deposu: Redis istemcisi
// varsa Redis (verify:<kanal>:{usr_...}); yoksa (MOCK) bellek.
func buildVerificationStore(client *redis.Client, channel verification.Channel) verification.Store {
	if client == nil {
		return verification.NewMemory(time.Now)
	}
	return verification.NewRedis(client, channel)
}

// buildMailer, iletinin gidecegi yer.
func buildMailer(cfg config.Config) (emailverify.Mailer, error) {
	if cfg.SMTPAddress == "" {
		return mail.NewMemory(), nil
	}
	return mail.NewSMTP(mail.SMTPOptions{Address: cfg.SMTPAddress, From: cfg.MailFrom, Timeout: cfg.SMTPTimeout, Now: time.Now})
}

// derivedKey, sirdan etikete ozgu bir anahtar turetir (HMAC).
func derivedKey(secret []byte, label string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(label))
	return mac.Sum(nil)
}
