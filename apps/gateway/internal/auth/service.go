// Package auth, kimlik use-case'leridir (T8.1): kayit, giris, yenileme, cikis,
// profil ve siparis anindaki oturum sinyalleri. Kimlik telefon + sifre ile
// kurulur (ADR-12).
//
// HTTP'yi ve Mongo'yu BILMEZ: girdi dogrulanmis gelir (httpapi, rules.go),
// kayitlar depolardan okunur (authstore). Is sonuclari *apperror.Error olarak
// doner (INVALID_CREDENTIALS, PHONE_ALREADY_REGISTERED, UNAUTHORIZED); altyapi
// hatalari sarmalanip yukari tasinir ve hata isleyicide INTERNAL olur.
package auth

import (
	"time"
)

// Sebepler: istemcinin gordugu alan mesajlari.
const (
	phoneTakenReason     = "bu numarayla kayitli bir hesap var"
	refreshInvalidReason = "gecersiz, kullanilmis ya da suresi dolmus"
	sessionEndedReason   = "oturum kapatilmis ya da suresi dolmus; yeniden giris yap"
	// fieldRefreshCookie, yenileme jetonunun cerezi: gecersiz jetonun hatasi
	// istemcinin gonderdigi seyin adiyla doner (httpapi RefreshCookie ile ayni).
	fieldRefreshCookie = "getir_refresh"
	// fieldAuthorization, erisim jetonunun basligi: oturumu biten jetonun
	// hatasi da bu adla doner (kimlik ara katmaniyla ayni).
	fieldAuthorization = "Authorization"
)

// Passwords, sifre ozetleme; gercegi PasswordHasher (bcrypt).
type Passwords interface {
	Hash(password string) (string, error)
	Matches(hash, password string) (bool, error)
	Burn(password string) bool
}

// TokenIssuer, erisim jetonu uretimi; gercegi Tokens (JWT).
type TokenIssuer interface {
	Issue(identity Identity) (string, error)
	TTL() time.Duration
}

// Deps, servisin disaridan aldigi her sey.
type Deps struct {
	Users     UserStore
	Sessions  SessionStore
	Passwords Passwords
	Tokens    TokenIssuer
	// Locator, IP'yi oturum konumuna cevirir; yerelde NoLocator.
	Locator Locator
	// RefreshTTL, yenileme jetonunun omru (REFRESH_TTL).
	RefreshTTL time.Duration
	// Now, saat; testte sabitlenir.
	Now func() time.Time
}

// Service, kimlik use-case'leri.
type Service struct {
	deps Deps
}

// NewService, bagimliliklarla kurar.
func NewService(deps Deps) *Service {
	return &Service{deps: deps}
}
