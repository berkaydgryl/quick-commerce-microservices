// Package roomtoken, siparis odasinin kisa omurlu jetonunu uretir (T12.2).
//
// GET /v1/orders/{id}/token: gateway siparisin SAHIBINI denetler (order
// GetOrder; baskasinin siparisi 404, mevcut kural) ve realtime-service'in
// room.join'de dogrulayacagi jetonu imzalar. Realtime jetonu kendisi dogrular,
// gRPC cagirmaz (docs/api/socket-events.md).
//
// Jeton erisim jetonundan AYRI bir sirla imzalanir (REALTIME_TOKEN_SECRET) ve
// `aud = realtime` tasir: erisim jetonu oda jetonu yerine, oda jetonu erisim
// jetonu yerine gecemez. Alanlar ve omur @getir/contracts socket.ts'teki
// REALTIME_TOKEN sabitleriyle aynidir (contract_test.go denetler).
package roomtoken

import (
	"context"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Sozlesme sabitleri (contracts REALTIME_TOKEN). Degisirse realtime da
// degismeli; contract_test.go iki tarafi karsilastirir.
const (
	// Algorithm, tek imza algoritmasi.
	Algorithm = "HS256"
	// Issuer, `iss`: erisim jetonuyla ayni verici.
	Issuer = "getir-gateway"
	// Audience, `aud`: realtime yalnizca bunu tasiyan jetonu kabul eder.
	Audience = "realtime"
	// RoomClaim, jetonun yetkili oldugu TEK odanin alani.
	RoomClaim = "room"
	// TTL, jetonun omru: yalnizca katilimda denetlenir.
	TTL = 60 * time.Second
)

// orderRoomPrefix, siparis odasinin oneki (contracts ROOM_PREFIX.order).
const orderRoomPrefix = "order:"

// Token, ucun cevabi (contracts realtimeTokenSchema).
type Token struct {
	Token      string `json:"token"`
	Room       string `json:"room"`
	ExpiresAt  string `json:"expiresAt"`
	TTLSeconds int64  `json:"ttlSeconds"`
}

// claims, jetonun govdesi: sub = kullanici, room = order:{orderId}.
type claims struct {
	Room string `json:"room"`
	jwt.RegisteredClaims
}

// Signer, oda jetonunu imzalar.
type Signer struct {
	secret []byte
	now    func() time.Time
}

// NewSigner, sir ve saatle kurar. Sirrin kurallari yapilandirmada denetlenir
// (en az 32 bayt, JWT_SECRET'tan farkli).
func NewSigner(secret []byte, now func() time.Time) *Signer {
	return &Signer{secret: secret, now: now}
}

// OrderRoom, siparisin oda adi.
func OrderRoom(orderID string) string {
	return orderRoomPrefix + orderID
}

// Sign, kullanicinin siparis odasi icin jeton uretir. Sahiplik burada
// DENETLENMEZ; Service once denetler.
func (s *Signer) Sign(userID, orderID string) (Token, error) {
	// JWT zamanlari saniye hassasiyetindedir: cevaptaki expiresAt jetonun exp'iyle
	// birebir ayni olsun diye saniyeye kirpilir.
	issuedAt := s.now().UTC().Truncate(time.Second)
	expiresAt := issuedAt.Add(TTL)
	room := OrderRoom(orderID)
	body := claims{
		Room: room,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{Audience},
			IssuedAt:  jwt.NewNumericDate(issuedAt),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, body).SignedString(s.secret)
	if err != nil {
		return Token{}, fmt.Errorf("oda jetonu imzalanamadi: %w", err)
	}
	return Token{
		Token:      signed,
		Room:       room,
		ExpiresAt:  expiresAt.Format(time.RFC3339Nano),
		TTLSeconds: int64(TTL / time.Second),
	}, nil
}

// OwnerCheck, siparisin kullaniciya ait oldugunu denetler: degilse ya da yoksa
// NOT_FOUND (order-service kurali; varligi sizdirilmaz). Gateway'de
// order.Service.Get'e baglanir.
type OwnerCheck func(ctx context.Context, userID, orderID string) error

// Service, ucun isini yapar: sahiplik, sonra imza.
type Service struct {
	owns   OwnerCheck
	signer *Signer
}

// NewService, sahiplik denetimi ve imzaciyla kurar.
func NewService(owns OwnerCheck, signer *Signer) *Service {
	return &Service{owns: owns, signer: signer}
}

// Issue, siparis sahibine oda jetonu verir. Siparisin durumuna bakilmaz:
// iptal ya da teslim edilmis siparisin sahibi de son durumu izleyebilir.
func (s *Service) Issue(ctx context.Context, userID, orderID string) (Token, error) {
	if err := s.owns(ctx, userID, orderID); err != nil {
		return Token{}, err
	}
	return s.signer.Sign(userID, orderID)
}
