package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// tokenIssuer, jetonun "iss" alani: baska bir sistemin ayni sirla imzaladigi
// jeton burada gecmesin.
const tokenIssuer = "getir-gateway"

// errForeignClaims, imzasi dogru ama kimlik alanlari bicim disi jeton.
var errForeignClaims = errors.New("jeton kimlik alanlari bicim disi")

// Identity, dogrulanmis erisim jetonunun tasidigi kimlik.
type Identity struct {
	UserID    string
	SessionID string
}

// accessClaims, erisim jetonunun govdesi: sub = kullanici, sid = oturum.
type accessClaims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

// Tokens, erisim jetonunu (JWT, HS256) uretir ve dogrular (ADR-12). Realtime bu
// jetonu KULLANMAZ: siparis odasi icin ayri sirla imzalanan kisa omurlu oda
// jetonu vardir (internal/roomtoken, T12.2; room.join'de tasinir, ADR-06 eki).
type Tokens struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

// NewTokens, sir, omur ve saatle kurar. Sirrin uzunlugu yapilandirmada denetlenir.
func NewTokens(secret []byte, ttl time.Duration, now func() time.Time) *Tokens {
	return &Tokens{secret: secret, ttl: ttl, now: now}
}

// TTL, erisim jetonunun omru (JWT_TTL).
func (t *Tokens) TTL() time.Duration {
	return t.ttl
}

// Issue, kimlik icin imzali bir erisim jetonu uretir.
func (t *Tokens) Issue(identity Identity) (string, error) {
	issuedAt := t.now()
	claims := accessClaims{
		SessionID: identity.SessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    tokenIssuer,
			Subject:   identity.UserID,
			IssuedAt:  jwt.NewNumericDate(issuedAt),
			ExpiresAt: jwt.NewNumericDate(issuedAt.Add(t.ttl)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	if err != nil {
		return "", fmt.Errorf("erisim jetonu imzalanamadi: %w", err)
	}
	return signed, nil
}

// Verify, jetonu dogrular ve kimligi doner.
//
// YALNIZCA HS256 kabul edilir: "alg: none" ya da baska bir algoritmayla gelen
// jeton reddedilir (algoritma karistirma saldirisi). Suresi, vericisi ve
// imzasi denetlenir; kimlik alanlari da bicim disiysa jeton gecersizdir.
func (t *Tokens) Verify(token string) (Identity, error) {
	parsed, err := jwt.ParseWithClaims(token, &accessClaims{}, t.key,
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(tokenIssuer),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(t.now),
	)
	if err != nil {
		return Identity{}, fmt.Errorf("erisim jetonu gecersiz: %w", err)
	}
	claims, ok := parsed.Claims.(*accessClaims)
	if !ok || !ids.Valid(ids.User, claims.Subject) || !ids.Valid(ids.Session, claims.SessionID) {
		return Identity{}, errForeignClaims
	}
	return Identity{UserID: claims.Subject, SessionID: claims.SessionID}, nil
}

func (t *Tokens) key(*jwt.Token) (any, error) {
	return t.secret, nil
}
