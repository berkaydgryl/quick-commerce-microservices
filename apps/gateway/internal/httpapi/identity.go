package httpapi

import (
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Kullanici kimligi (T8.1): korumali uclar "Authorization: Bearer <erisim
// jetonu>" ister (ADR-12). Jeton imzali JWT'dir; kimlik YALNIZCA ondan gelir.
// T7.5'teki X-User-Id gelistirme basligi kaldirildi: imzasiz bir baslik her
// ortamda herkesin kendini baska biri gibi tanitmasina izin verirdi.
//
// Kimligi belirleyen TEK yer bu ara katmandir; handler'lar userIDOf(c) ya da
// identityOf(c) okur.

const (
	userIDLocal    = "userId"
	sessionIDLocal = "sessionId"
)

// bearerScheme, tek desteklenen sema. Sema adi buyuk-kucuk harfe duyarsizdir
// (RFC 7235): "bearer" da kabul edilir.
const bearerScheme = "Bearer"

const (
	missingTokenReason = "Bearer erisim jetonu gerekli"
	invalidTokenReason = "gecersiz ya da suresi dolmus erisim jetonu"
)

// WWW-Authenticate degerleri (RFC 6750): 401 cevabi hangi semanin beklendigini
// soyler; jeton gecersizse istemci bunu "yenile ya da yeniden giris yap"
// diye okur.
const (
	bearerChallenge       = bearerScheme
	invalidTokenChallenge = bearerScheme + ` error="invalid_token"`
)

// requireUser, korumali uclarin kimlik ara katmani. Jeton yoksa, bicimsizse,
// imzasi tutmuyorsa ya da suresi dolduysa 401 UNAUTHORIZED; handler ve arkadaki
// servis HIC cagrilmaz.
//
// Jetonun kendisi gunluge ve cevaba yazilmaz; dogrulama hatasinin sebebi
// (suresi dolmus, imza) yalnizca gunlukte, sarmalanmis hatada kalir.
func requireUser(verifier AccessTokenVerifier) fiber.Handler {
	return func(c fiber.Ctx) error {
		token, found := bearerToken(c.Get(fiber.HeaderAuthorization))
		if !found {
			c.Set(fiber.HeaderWWWAuthenticate, bearerChallenge)
			return apperror.New(apperror.CodeUnauthorized, map[string]string{fiber.HeaderAuthorization: missingTokenReason})
		}
		identity, err := verifier.Verify(token)
		if err != nil {
			c.Set(fiber.HeaderWWWAuthenticate, invalidTokenChallenge)
			return &apperror.Error{
				Code:    apperror.CodeUnauthorized,
				Details: map[string]any{fiber.HeaderAuthorization: invalidTokenReason},
				Cause:   err,
			}
		}
		c.Locals(userIDLocal, identity.UserID)
		c.Locals(sessionIDLocal, identity.SessionID)
		return c.Next()
	}
}

// bearerToken, basliktan jetonu ayirir: "Bearer <jeton>".
func bearerToken(header string) (string, bool) {
	scheme, token, found := strings.Cut(strings.TrimSpace(header), " ")
	if !found || !strings.EqualFold(scheme, bearerScheme) {
		return "", false
	}
	token = strings.TrimSpace(token)
	return token, token != ""
}

// userIDOf, requireUser'in koydugu kimlik. Ara katmandan gecmeyen istekte bos.
func userIDOf(c fiber.Ctx) string {
	if userID, ok := c.Locals(userIDLocal).(string); ok {
		return userID
	}
	return ""
}

// identityOf, jetondaki kullanici ve oturum (siparis sinyalleri oturumdan okunur).
func identityOf(c fiber.Ctx) auth.Identity {
	sessionID, _ := c.Locals(sessionIDLocal).(string)
	return auth.Identity{UserID: userIDOf(c), SessionID: sessionID}
}
