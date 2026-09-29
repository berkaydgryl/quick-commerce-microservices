package httpapi

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Yenileme jetonunun cerezi (T8.5 hazirligi): jeton cevap govdesinde DEGIL,
// gateway'in yazdigi cerezde tasinir.
//
//	HttpOnly        sayfadaki betik okuyamaz: XSS 14 gunluk jetonu calamaz
//	SameSite=Strict baska bir siteden gelen istek cerezi tasimaz (CSRF)
//	Path=/v1/auth   jeton yalnizca kimlik uclarina gider; katalog ya da
//	                siparis isteklerinde gezmez
//	Max-Age         REFRESH_TTL; her yenilemede jeton degisir, sure yeniden baslar
//	Secure          yalnizca production'da (gelistirme http://localhost)
//
// Erisim jetonu govdede kalir: omru kisadir (JWT_TTL) ve istemci onu bellekte
// tutar. Sayfa yenilenince istemci /v1/auth/refresh'i cagirir; cerez kendiliginden
// gider ve yeni erisim jetonu gelir.

// RefreshCookie, yenileme jetonu cerezinin adi.
const RefreshCookie = "getir_refresh"

// refreshCookiePath, cerezin gonderildigi yol: yalnizca kimlik uclari.
const refreshCookiePath = "/v1/auth"

// refreshCookies, cerezin ortama gore ayari (cihaz cereziyle ayni kural).
type refreshCookies struct {
	secure bool
}

// set, jetonu cereze yazar; omur jetonun sunucudaki omrudur.
func (r refreshCookies) set(c fiber.Ctx, token string, ttl time.Duration) {
	c.Cookie(r.cookie(token, int(ttl/time.Second)))
}

// clear, cerezi siler (Max-Age < 0): cikista ve kullanilamayan jetonda.
// Tarayici olu jetonu her yenilemede tekrar gondermesin.
func (r refreshCookies) clear(c fiber.Ctx) {
	c.Cookie(r.cookie("", -1))
}

func (r refreshCookies) cookie(value string, maxAge int) *fiber.Cookie {
	return &fiber.Cookie{
		Name:     RefreshCookie,
		Value:    value,
		Path:     refreshCookiePath,
		MaxAge:   maxAge,
		HTTPOnly: true,
		SameSite: fiber.CookieSameSiteStrictMode,
		Secure:   r.secure,
	}
}

// token, istegin yenileme jetonu; cerez yoksa ya da bossa "" doner.
func (r refreshCookies) token(c fiber.Ctx) string {
	// Fiber'in dondurdugu metin istek tamponuna baglidir; servise gidecek
	// deger kopyalanir.
	return strings.TrimSpace(strings.Clone(c.Cookies(RefreshCookie)))
}

// refreshCookieMissing, cerezsiz yenileme: oturum yok (401). Istemci
// girise yonlenir; 400 degil, cunku istek bicimsel olarak hatali degil.
func refreshCookieMissing() error {
	return apperror.New(apperror.CodeUnauthorized, map[string]string{RefreshCookie: requiredReason})
}
