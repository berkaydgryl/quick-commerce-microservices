package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
)

// emailCodeKeyLabel, dogrulama kodu ozetinin anahtarinin JWT sirrindan
// turetilme etiketi (parmak izi anahtariyla ayni yontem, ayri etiket: anahtar
// jeton imzalayamaz, parmak izi uretemez).
const emailCodeKeyLabel = "getir-gateway/email-code/v1"

// buildEmailVerification, e-posta dogrulamasini kurar (T11.14).
//
//	ileti: SMTP_URL varsa SMTP (gelistirmede Mailpit); yoksa (yalnizca MOCK)
//	       bellek kutusu, kod hicbir yere yazilmaz
//	depo:  Redis istemcisi varsa Redis; yoksa (MOCK) bellek
func buildEmailVerification(cfg config.Config, client *redis.Client, accounts emailverify.Accounts) (*emailverify.Service, error) {
	mailer, err := buildMailer(cfg)
	if err != nil {
		return nil, err
	}
	var store emailverify.Store = emailverify.NewMemory(time.Now)
	if client != nil {
		store = emailverify.NewRedis(client)
	}
	return emailverify.NewService(emailverify.Deps{
		Accounts: accounts,
		Store:    store,
		Mailer:   mailer,
		CodeKey:  derivedKey(cfg.JWTSecret.Bytes(), emailCodeKeyLabel),
		Now:      time.Now,
	}), nil
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
