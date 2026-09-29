// Package ratelimit, gateway'in hiz siniridir (T8.2, roadmap P2): kayan
// pencere gunlugu (sliding window log). Her kabul edilen istek zamaniyla
// kaydedilir; pencereden cikanlar atilir, kalanlar sayilir. Sabit pencerenin
// aksine sinir aninda patlama olmaz: pencere her istekte kayar.
//
// HTTP'yi bilmez: kararlari (hangi uc, hangi sinir, kim sayilir) httpapi
// verir. Sayac Redis'tedir, bellekte DEGIL: birden fazla gateway ornegi ayni
// Redis'i paylasir ve sinir ornek sayisindan bagimsiz tutar (proje kurallari,
// P2). Bellek sayaci yalnizca MOCK ve testler icindir.
package ratelimit

import (
	"context"
	"errors"
	"time"
)

// ErrUnavailable, sayacin deposuna ulasilamadigini soyler; cagiran istegi
// gecirir (fail-open: hiz siniri kesintide siparisi durdurmaz).
var ErrUnavailable = errors.New("hiz siniri deposuna ulasilamiyor")

// Decision, bir istegin sonucu.
type Decision struct {
	Allowed bool
	// RetryAfter, reddedilen istegin kabul edilebilecegi en erken an: pencerede
	// kalan en eski kaydin dusmesine kalan sure (en az 1 ms).
	RetryAfter time.Duration
}

// Limiter, kayan pencere sayaci. Yalnizca KABUL edilen istek sayilir:
// reddedilen istek pencereye yazilmaz; sayac hicbir zaman siniri asmaz ve
// israrli istemci deponun bellegini buyutemez.
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error)
}

// Key, Redis anahtari: rate:{ozne}:rota (@getir/redis-kit rateLimitKey). Ozne
// IP ya da kullanici kimligidir; rota "POST_/v1/orders" bicimindedir.
func Key(subject, route string) string {
	return "rate:{" + subject + "}:" + route
}
