package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Kimlik uclari (T8.1; openapi: registerUser, loginUser, refreshSession,
// logoutSession, getMe). Kayit, giris, yenileme ve cikis kimliksizdir, cunku
// kimligi onlar kurar ya da bitirir; /v1/me erisim jetonu ister (requireUser).
// Siparis uclariyla ayni sira: bilinmeyen sorgu parametresini reddet -> govdeyi
// ve basligi dogrula (hatalar TEK cevapta) -> cagir -> zarfla.
//
// Sifre ve jetonlar gunluge YAZILMAZ: istek gunlugu yalnizca yol ve durum
// tasir, hata gunlugu yalnizca sebebi.

// noStore, jeton ya da kisisel veri tasiyan cevabin basligi: ne tarayici
// onbellegine ne araya giren bir vekile kalmali (RFC 6749 5.1, RFC 9111).
const noStore = "no-store"

// registerHandler, POST /v1/auth/register: hesap acar ve oturumu baslatir (201).
//
// Idempotency-Key ZORUNLU (ADR-08, kalici kayit yaratan uc) ama bugun yalnizca
// VARLIGI denetlenir; ayni anahtarla gelen tekrarin ilk cevabi almasi T8.2'de
// gateway'e gelir. O zamana kadar tekrar eden kayit PHONE_ALREADY_REGISTERED
// alir: ikinci hesap acilmaz, telefon benzersizligi bunu garanti eder.
func registerHandler(registrar UserRegistrar, devices deviceCookies) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body registerBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		grant, err := registrar.Register(c.Context(), input, requestMeta(c, devices))
		if err != nil {
			return err
		}
		return private(c, http.StatusCreated, grant)
	}
}

// loginHandler, POST /v1/auth/login: telefon ve sifreyle oturum acar.
// Kalici bir kaynak yaratmadigi icin Idempotency-Key istemez (openapi).
func loginHandler(authenticator UserAuthenticator, devices deviceCookies) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body loginBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		grant, err := authenticator.Login(c.Context(), input, requestMeta(c, devices))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, grant)
	}
}

// refreshHandler, POST /v1/auth/refresh: yenileme jetonunu yenisiyle
// degistirir ve yeni erisim jetonu verir. Erisim jetonu istemez: suresi dolmus
// olmasi bu ucun cagrilma sebebidir.
func refreshHandler(refresher SessionRefresher) fiber.Handler {
	return func(c fiber.Ctx) error {
		token, err := refreshTokenOf(c)
		if err != nil {
			return err
		}
		grant, err := refresher.Refresh(c.Context(), token)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, grant)
	}
}

// logoutHandler, POST /v1/auth/logout: yenileme jetonunu iptal eder. Tekrari
// zararsizdir (ikincisi revoked:false alir), bu yuzden Idempotency-Key istemez.
func logoutHandler(revoker SessionRevoker) fiber.Handler {
	return func(c fiber.Ctx) error {
		token, err := refreshTokenOf(c)
		if err != nil {
			return err
		}
		revoked, err := revoker.Logout(c.Context(), token)
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, logoutResult{Revoked: revoked})
	}
}

// meHandler, GET /v1/me: oturumdaki kullanicinin profili.
func meHandler(profiles ProfileGetter) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		profile, err := profiles.Profile(c.Context(), userIDOf(c))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, profile)
	}
}

// refreshTokenOf, yenileme ve cikis govdesinden jetonu okur.
func refreshTokenOf(c fiber.Ctx) (string, error) {
	if err := rejectUnknownQuery(c); err != nil {
		return "", err
	}
	var body refreshTokenBody
	if err := decodeJSONBody(c, &body); err != nil {
		return "", err
	}
	errs := fieldErrors{}
	token := body.token(errs)
	if len(errs) > 0 {
		return "", apperror.New(apperror.CodeValidationFailed, errs)
	}
	return token, nil
}

// requestMeta, oturumun SUNUCU tarafi bilgisi: baglantinin IP'si ve gateway'in
// verdigi cihaz kimligi (B9: risk sinyali istemcinin beyanindan alinmaz).
// Cihaz cerezi yoksa burada verilir; basarisiz giriste de cihaz tanimlanir.
func requestMeta(c fiber.Ctx, devices deviceCookies) auth.RequestMeta {
	return auth.RequestMeta{IPAddress: c.IP(), DeviceID: devices.ensure(c)}
}

// private, onbelleklenmemesi gereken basarili cevabi yazar.
func private(c fiber.Ctx, status int, data any) error {
	c.Set(fiber.HeaderCacheControl, noStore)
	return ok(c, status, data)
}
