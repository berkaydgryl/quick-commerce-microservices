package httpapi

// 3DS yanlis kod siniri (#163): siparisler arasi kaba kuvvete karsi. Her
// siparisin 3DS'i kendi icinde 3 hak tanir; vazgecip yeniden siparis veren
// kullanici her seferinde yeni 3 hak alirdi.
//
//	kullanici basina YANLIS KOD -> saatte 5, gunde 10 (her zaman acik)
//	IP basina YANLIS KOD        -> saatte 30 (cok hesapla deneme; varsayilan KAPALI)
//
// IP soketin adresidir (byClientIP): yuk dengeleyici, ingress ya da Vite vekili
// arkasinda herkes ayni IP olur ve IP penceresi herkesin kart odemesini bir saat
// kilitlerdi (G1). Guvenilir vekil destegi gelene kadar (#213(3))
// THREEDS_IP_LIMIT_ENABLED ile yalniz dogrudan baglantida acilir.
//
// Dogru kod, sure dolmasi, bicimsiz istek, tekrar ve kesinti sayilmaz: ayni
// NAT'in arkasindaki kullanicilar birbirinin hakkini cop istekle tuketemez.
// Esik asilinca POST /v1/orders/{id}/3ds ve kartla POST /v1/orders order'a
// GITMEDEN 429 RATE_LIMITED + Retry-After (yeni 3DS hakki da acilmaz). Kapi
// tekrar korumasindan SONRA, govde dogrulandiktan sonra calisir: ayni anahtarli
// tekrar ilk cevabi alir, 429 saklanmaz. Sayacin deposuna ulasilamazsa istek
// gecer (fail-open). Kart eklemedeki gibi tek dogrulama kilidi yok: kullanicinin
// ayni anda tek aktif siparisi ve tek 3DS'i vardir (RESERVATION_ACTIVE), o da 3
// hakla sinirli; es zamanli denemeler kullanici sinirini en fazla 2 asar. IP
// penceresini ayni anda acik 3DS'i olan K hesap tek patlamada K*3'e kadar asabilir
// (her hesap yine kendi sinirinda). Her denemenin sonucu
// threeds_attempts_total{result} metrigine yazilir.

import (
	"slices"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// Sayac rotalari (rate:{ozne}:rota); genel hiz sinirinin rotasindan ayridir.
const (
	threeDSFailHourRoute   = "POST_/v1/orders/3ds/fail-1h"
	threeDSFailDayRoute    = "POST_/v1/orders/3ds/fail-1d"
	threeDSIPFailHourRoute = "POST_/v1/orders/3ds/ip-fail-1h"
)

// threeDSUserWindows, kullanici basina yanlis kod pencereleri (her zaman acik).
var threeDSUserWindows = []attemptWindow{
	{route: threeDSFailHourRoute, limit: order.ThreeDSFailuresPerHour, length: time.Hour},
	{route: threeDSFailDayRoute, limit: order.ThreeDSFailuresPerDay, length: day},
}

// threeDSIPWindow, IP basina yanlis kod penceresi (yalniz ipLimit ile).
var threeDSIPWindow = attemptWindow{route: threeDSIPFailHourRoute, limit: order.ThreeDSFailuresPerIPPerHour, length: time.Hour, perIP: true}

// threeDSWindows, acik pencereler; ortak dilim degistirilmez.
func threeDSWindows(ipLimit bool) []attemptWindow {
	if !ipLimit {
		return threeDSUserWindows
	}
	return append(slices.Clip(threeDSUserWindows), threeDSIPWindow)
}

// threeDSAttempts, 3DS onayinin deneme siniri ve sonuc kaydi.
type threeDSAttempts struct {
	gate     attemptGate
	recorder RequestMetrics
}

// newThreeDSAttempts, sayac nil ise sinir kapali (hiz siniri kapaliyken);
// ipLimit false ise yalniz kullanici pencereleri.
func newThreeDSAttempts(failures ratelimit.FailureCounter, ipLimit bool, limits rateLimiter, recorder RequestMetrics) threeDSAttempts {
	return threeDSAttempts{
		gate:     attemptGate{windows: threeDSWindows(ipLimit), failures: failures, warning: limits.warning},
		recorder: recorder,
	}
}

// admitConfirm, POST /v1/orders/{id}/3ds: order'a gitmeden once; esikteyse 429
// ve metrige "limited".
func (a threeDSAttempts) admitConfirm(c fiber.Ctx) error {
	wait, limited := a.gate.check(c)
	if !limited {
		return nil
	}
	a.recorder.CountThreeDSAttempt(string(order.ThreeDSLimited))
	return rejectAttempt(c, a.recorder, wait)
}

// admitCardOrder, kartla POST /v1/orders: esikteyse yeni siparis (ve yeni 3DS
// hakki) acilmaz. 3DS denemesi olmadigi icin 3DS metrigine yazilmaz; ret
// rate_limit_rejections_total{route} ile sayilir.
func (a threeDSAttempts) admitCardOrder(c fiber.Ctx) error {
	if wait, limited := a.gate.check(c); limited {
		return rejectAttempt(c, a.recorder, wait)
	}
	return nil
}

// observe, order'in cevabini metrige ve (yanlis kodsa) sayaclara yazar.
func (a threeDSAttempts) observe(c fiber.Ctx, err error) {
	outcome := order.ClassifyThreeDS(err)
	a.recorder.CountThreeDSAttempt(string(outcome))
	if outcome.CountsAsFailure() {
		a.gate.recordFailure(c)
	}
}
