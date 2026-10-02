package httpapi

import (
	"errors"
	"net/http"
	"time"

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
// tasir, hata gunlugu yalnizca sebebi. Yenileme jetonu govdede degil, HttpOnly
// cerezde tasinir (refresh_cookie.go).

// noStore, jeton ya da kisisel veri tasiyan cevabin basligi: ne tarayici
// onbellegine ne araya giren bir vekile kalmali (RFC 6749 5.1, RFC 9111).
const noStore = "no-store"

// registerHandler, POST /v1/auth/register: hesap acar ve oturumu baslatir (201).
//
// Idempotency-Key ZORUNLU (ADR-08, kalici kayit yaratan uc). Tekrar korumasi
// ara katmandadir (idempotency.go); kayit ucunun cevabi jeton tasidigi icin
// saklanmaz: biten kaydin tekrari buraya gelir ve PHONE_ALREADY_REGISTERED alir.
func registerHandler(registrar UserRegistrar, devices deviceCookies, sessions refreshCookies) fiber.Handler {
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
		return session(c, http.StatusCreated, grant, sessions)
	}
}

// loginHandler, POST /v1/auth/login: telefon ve sifreyle oturum acar.
// Kalici bir kaynak yaratmadigi icin Idempotency-Key istemez (openapi).
func loginHandler(authenticator UserAuthenticator, devices deviceCookies, sessions refreshCookies) fiber.Handler {
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
		return session(c, http.StatusOK, grant, sessions)
	}
}

// addAddressHandler, POST /v1/me/addresses (T11.8): oturumdaki kullanicinin
// adres defterine yeni adres; cevap guncel defter (201). Kalici kayit:
// Idempotency-Key ister (ADR-08); eksik anahtar ve govde sorunlari tek cevapta.
// Kisisel veri: onbelleklenmez.
func addAddressHandler(adder AddressAdder) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body addressCreateBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		book, err := adder.AddAddress(c.Context(), userIDOf(c), input)
		if err != nil {
			return err
		}
		return private(c, http.StatusCreated, book)
	}
}

// phoneCheckHandler, POST /v1/auth/phone-check (T11.7): numarayla kayitli bir
// hesap var mi. Numara govdededir, adreste degil: kisisel veri adres
// gunluklerine ve izlere yazilmasin. Kalici bir sey degistirmez; bu yuzden
// Idempotency-Key istemez (giris gibi). Cevap onbelleklenmez.
func phoneCheckHandler(checker PhoneChecker) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body phoneCheckBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		registered, err := checker.PhoneRegistered(c.Context(), input)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, phoneCheckResult{Registered: registered})
	}
}

// refreshHandler, POST /v1/auth/refresh: cerezdeki yenileme jetonunu
// yenisiyle degistirir (cereze yazar) ve yeni erisim jetonu verir. Erisim
// jetonu istemez: suresi dolmus olmasi bu ucun cagrilma sebebidir. Govde
// okunmaz; jeton yalnizca cerezden gelir.
//
// Kullanilamayan jetonun (gecersiz, kullanilmis, suresi dolmus) cerezi
// silinir: tarayici olu jetonu her acilista yeniden gondermesin.
func refreshHandler(refresher SessionRefresher, sessions refreshCookies) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		token := sessions.token(c)
		if token == "" {
			return refreshCookieMissing()
		}
		grant, err := refresher.Refresh(c.Context(), token)
		if err != nil {
			if unauthorized(err) {
				sessions.clear(c)
			}
			return err
		}
		return session(c, http.StatusOK, grant, sessions)
	}
}

// logoutHandler, POST /v1/auth/logout: cerezdeki yenileme jetonunu iptal eder
// ve cerezi siler. Tekrari zararsizdir (ikincisi ya da cerezsiz cagri
// revoked:false alir), bu yuzden Idempotency-Key istemez.
func logoutHandler(revoker SessionRevoker, sessions refreshCookies) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		token := sessions.token(c)
		revoked := false
		if token != "" {
			var err error
			if revoked, err = revoker.Logout(c.Context(), token); err != nil {
				return err
			}
		}
		sessions.clear(c)
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

// addressesHandler, GET /v1/me/addresses: oturumdaki kullanicinin adres
// defteri (T9.5). Kisisel veri: profil gibi onbelleklenmez.
func addressesHandler(addresses AddressBookGetter) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		book, err := addresses.Addresses(c.Context(), userIDOf(c))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, book)
	}
}

// session, oturumu baslatan ya da yenileyen cevabi yazar: yenileme jetonu
// cereze, gerisi (erisim jetonu, sureler, profil) onbelleklenmeyen govdeye.
func session(c fiber.Ctx, status int, grant auth.Grant, sessions refreshCookies) error {
	sessions.set(c, grant.RefreshToken, time.Duration(grant.RefreshExpiresIn)*time.Second)
	return private(c, status, grant)
}

// unauthorized, hata oturumu gecersiz kilan bir hata mi (401)?
func unauthorized(err error) bool {
	var appErr *apperror.Error
	return errors.As(err, &appErr) && appErr.Code == apperror.CodeUnauthorized
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
