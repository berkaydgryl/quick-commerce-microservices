package roomtoken

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testSecret  = "test-oda-jetonu-sirri-en-az-otuz-iki-bayt"
	testUserID  = "usr_0123456789abcdef0123456789abcdef"
	testOrderID = "ord_0123456789abcdef0123456789abcdef"
)

// Saniyenin ortasi: imza aninin saniyeye kirpildigi gorulsun.
var testNow = time.Date(2026, 10, 3, 12, 0, 0, 750_000_000, time.UTC)

func fixedNow() time.Time { return testNow }

// parse, jetonu realtime'in kurallariyla (HS256, iss, aud, exp) okur.
func parse(t *testing.T, token string) *claims {
	t.Helper()
	parsed, err := jwt.ParseWithClaims(token, &claims{}, func(*jwt.Token) (any, error) { return []byte(testSecret), nil },
		jwt.WithValidMethods([]string{Algorithm}),
		jwt.WithIssuer(Issuer),
		jwt.WithAudience(Audience),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(fixedNow),
	)
	if err != nil {
		t.Fatalf("jeton okunamadi: %v", err)
	}
	body, ok := parsed.Claims.(*claims)
	if !ok {
		t.Fatal("govde claims degil")
	}
	return body
}

func TestSignProducesRealtimeToken(t *testing.T) {
	token, err := NewSigner([]byte(testSecret), fixedNow).Sign(testUserID, testOrderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	if token.Room != "order:"+testOrderID || token.TTLSeconds != 60 {
		t.Errorf("oda ya da omur: %q %d", token.Room, token.TTLSeconds)
	}
	if token.ExpiresAt != "2026-10-03T12:01:00Z" {
		t.Errorf("expiresAt saniyeye kirpilmis imza ani + 60 sn olmali: %q", token.ExpiresAt)
	}

	body := parse(t, token.Token)
	if body.Subject != testUserID || body.Room != token.Room {
		t.Errorf("sub ya da room: %q %q", body.Subject, body.Room)
	}
	if got := body.ExpiresAt.Sub(body.IssuedAt.Time); got != TTL {
		t.Errorf("exp - iat %v olmali, %v", TTL, got)
	}
	if !body.IssuedAt.Equal(testNow.Truncate(time.Second)) {
		t.Errorf("iat imza ani olmali: %v", body.IssuedAt)
	}
}

func TestSignedTokenIsNotAnAccessToken(t *testing.T) {
	// Erisim jetonu dogrulamasi aud istemez ama baska sirla imzalanir; oda jetonu
	// erisim jetonu sirriyla dogrulanamamali.
	token, err := NewSigner([]byte(testSecret), fixedNow).Sign(testUserID, testOrderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	_, err = jwt.Parse(token.Token, func(*jwt.Token) (any, error) { return []byte("baska-bir-sir-erisim-jetonunun-sirri-32"), nil },
		jwt.WithValidMethods([]string{Algorithm}), jwt.WithTimeFunc(fixedNow))
	if !errors.Is(err, jwt.ErrTokenSignatureInvalid) {
		t.Errorf("baska sirla imza gecersiz olmali: %v", err)
	}
}

func TestIssueChecksOwnerBeforeSigning(t *testing.T) {
	notFound := errors.New("siparis bulunamadi")
	var asked []string
	owns := func(_ context.Context, userID, orderID string) error {
		asked = append(asked, userID+"/"+orderID)
		return notFound
	}

	_, err := NewService(owns, NewSigner([]byte(testSecret), fixedNow)).Issue(t.Context(), testUserID, testOrderID)

	if !errors.Is(err, notFound) {
		t.Errorf("sahiplik hatasi oldugu gibi gecmeli: %v", err)
	}
	if len(asked) != 1 || asked[0] != testUserID+"/"+testOrderID {
		t.Errorf("sahiplik bir kez, dogru kimliklerle sorulmali: %v", asked)
	}
}

func TestIssueSignsForOwner(t *testing.T) {
	owns := func(context.Context, string, string) error { return nil }

	token, err := NewService(owns, NewSigner([]byte(testSecret), fixedNow)).Issue(t.Context(), testUserID, testOrderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if parse(t, token.Token).Room != "order:"+testOrderID {
		t.Error("jeton siparisin odasina yetkili olmali")
	}
}
