// Package idempotency, mutasyon uclarinin tekrar korumasinin kayitlaridir
// (ADR-08 ve eki, T8.2). HTTP'yi bilmez: kaydi atomik alir, bitirir ya da
// birakir. Kararlari (ne saklanir, ne tekrar edilir) httpapi verir.
//
// Kayit yasami:
//
//	Claim    -> "isleniyor" (sahibinin jetonu ve istek parmak iziyle), kisa omur
//	Complete -> "bitti" (cevabin durum kodu ve gerekiyorsa govdesi), uzun omur
//	Release  -> silinir (sunucu hatasi, dogrulama hatasi: istemci ayni anahtarla
//	            yeniden deneyebilir)
//
// Complete ve Release yalnizca kayit HALA ayni jetonla "isleniyor" ise yazar:
// suresi dolup baska bir istegin aldigi kaydin ustune eski istek yazamaz.
package idempotency

import (
	"context"
	"errors"
	"time"
)

// Kaydin durumlari.
const (
	StateInProgress = "in-progress"
	StateDone       = "done"
)

// AnonymousScope, kimligi dogrulanmamis uclarin kapsami (kayit): anahtar tum
// anonim isteklerde ortaktir, farkli istegi parmak izi ayirir
// (@getir/redis-kit IDEMPOTENCY_ANONYMOUS_SCOPE ile ayni).
const AnonymousScope = "anon"

// ErrUnavailable, deponun ulasilamaz oldugunu soyler; cagiran 503 doner.
var ErrUnavailable = errors.New("idempotency deposuna ulasilamiyor")

// Record, idem:{kapsam}:anahtar kaydi.
type Record struct {
	State string `json:"state"`
	// Token, "isleniyor" kaydinin sahibi; bitmis kayitta bos.
	Token string `json:"token,omitempty"`
	// Fingerprint, istegin parmak izi (yontem + yol + govde; sunucu sirriyla).
	Fingerprint string `json:"fp"`
	// Status, bitmis istegin HTTP durum kodu.
	Status int `json:"status,omitempty"`
	// Body, bitmis istegin cevap govdesi; nil ise cevap tekrar edilmez
	// (kayit ucu: jeton Redis'e yazilmaz). omitempty YOK: bos govde ("")
	// saklanmis bir cevaptir, nil (null) saklanmamis; ikisi ayrisir.
	Body []byte `json:"body"`
}

// Store, kayitlarin deposu: Redis (gercek) ve bellek (MOCK, test).
type Store interface {
	// Claim, anahtari "isleniyor" kaydiyla ATOMIK alir. Anahtar doluysa
	// alinamaz ve mevcut kayit doner.
	Claim(ctx context.Context, key string, claim Record, ttl time.Duration) (claimed bool, existing Record, err error)
	// Complete, kaydi "bitti" yapar; kayit hala bu jetonla "isleniyor" degilse
	// hicbir sey yazmaz ve false doner.
	Complete(ctx context.Context, key, token string, done Record, ttl time.Duration) (bool, error)
	// Release, "isleniyor" kaydini siler; jeton tutmuyorsa false.
	Release(ctx context.Context, key, token string) (bool, error)
}

// Key, Redis anahtari: idem:{kapsam}:anahtar (@getir/redis-kit idempotencyKey).
// Kapsam kullanici kimligi ya da AnonymousScope'tur; anahtarin bicimi
// cagirandan once dogrulanmis olmalidir.
func Key(scope, key string) string {
	return "idem:{" + scope + "}:" + key
}
