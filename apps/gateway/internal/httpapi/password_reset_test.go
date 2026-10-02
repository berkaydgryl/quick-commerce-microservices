package httpapi

import (
	"net/http"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Demo sifre yenileme (T11.9) gercek servisle: kayit -> yenileme -> giris.

const resetPassword = "Yeni-Parola-2026"

func resetRequest(t *testing.T, phone, password string) *http.Request {
	t.Helper()
	return jsonRequest(t, http.MethodPost, "/v1/auth/password-reset", loginBodyOf(phone, password), nil)
}

func TestPasswordResetSignsInAndClosesOldSessions(t *testing.T) {
	app := authApp(t, silentLogger())
	_, header, _ := exchange(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))
	oldToken := refreshTokenOf(t, header)

	status, header, envelope := exchange(t, app, resetRequest(t, testPhone, resetPassword))

	// Giris gibi: 200, no-store, gövdede erisim jetonu, cerezde yeni yenileme jetonu.
	if status != http.StatusOK || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("yenileme 200 ve no-store donmeli: %d %+v", status, envelope)
	}
	grant := dataOf[auth.Grant](t, envelope)
	newToken := refreshTokenOf(t, header)
	if grant.AccessToken == "" || grant.User.Phone != testPhone || newToken == oldToken {
		t.Errorf("yeni oturum acilmali: %+v", grant)
	}
	// Eski oturum kapandi, yenisi calisir.
	if status, _, _ := exchange(t, app, withRefresh(authPost(t, "/v1/auth/refresh"), oldToken)); status != http.StatusUnauthorized {
		t.Errorf("eski oturum kapanmali: %d", status)
	}
	if status, _, _ := exchange(t, app, withRefresh(authPost(t, "/v1/auth/refresh"), newToken)); status != http.StatusOK {
		t.Errorf("yeni oturum yenilenebilmeli: %d", status)
	}
	// Yeni sifre gecer, eskisi gecmez.
	if status, _ := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, resetPassword), nil)); status != http.StatusOK {
		t.Errorf("yeni sifreyle giris 200 donmeli: %d", status)
	}
	if status, _ := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil)); status != http.StatusUnauthorized {
		t.Errorf("eski sifre reddedilmeli: %d", status)
	}
}

func TestPasswordResetForUnknownPhoneIsFieldError(t *testing.T) {
	app := authApp(t, silentLogger())

	status, envelope := send(t, app, resetRequest(t, testPhone, resetPassword))

	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed ||
		detailsOf(t, envelope)[auth.FieldPhone] != "Bu numarayla kayıtlı bir hesap yok" {
		t.Errorf("kayitsiz numara 400 ve telefon ayrintisi donmeli: %d %+v", status, envelope)
	}
}

func TestPasswordResetCollectsFormatErrorsWithoutIdempotencyKey(t *testing.T) {
	// Giris gibi anahtar istemez; telefon kurali (5 ile baslayan cep) ve sifre kurali tek cevapta.
	app := authApp(t, silentLogger())

	status, envelope := send(t, app, resetRequest(t, "+901231231312", "kisa"))

	details := detailsOf(t, envelope)
	if status != http.StatusBadRequest || details[auth.FieldPhone] == nil || details[auth.FieldPassword] == nil {
		t.Errorf("iki bicim hatasi birden bekleniyordu: %d %+v", status, details)
	}
	if details[IdempotencyKeyHeader] != nil {
		t.Errorf("sifre yenileme Idempotency-Key istememeli: %+v", details)
	}
}

func TestPasswordResetIsNotMountedWithoutResetter(t *testing.T) {
	// Production'da (bootstrap resetter vermez) uc hic yoktur: kimlik kanitlanmadan sifre degismez.
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, AccessTokens: testTokens(), Idempotency: testIdempotency(), Logger: silentLogger()})

	status, _ := send(t, app, resetRequest(t, testPhone, resetPassword))

	if status != http.StatusNotFound {
		t.Errorf("uc baglanmamali (404): %d", status)
	}
}
