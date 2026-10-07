package httpapi

// QA (T15.2, risk geriye donuk PR 1; RQ0c): odemede 3DS beklerken "vazgec ve yeniden ac" dongusunun
// hiz siniri. Kullanicinin sorusu: dongu 3DS deneme sinirini atlatmak icin kac kez kosabilir?
//
// Sinirlar uretimin VARSAYILANLARI, config.Load'dan (bos ortam); sayac bellekte, saat duruk
// (pencere icinde). Bir tur web'in istek dizisidir: rezervasyon (POST /v1/cart/reserve), siparis
// (POST /v1/orders), k yanlis kod (POST /v1/orders/{id}/3ds) ve birakma (DELETE
// /v1/cart/reserve/{id}: 3DS penceresini kapatma ya da sure dolumu); her tur YENI siparis kimligiyle.
// Yalniz F5'te birakma istegi gitmez: yeni rezervasyon kilit dusene kadar 409 alir (order tarafi).
//
// Olcum (MEVCUT davranis): sayac kullanici ve ROTA SABLONU basinadir; 3DS sayaci yeni siparisle
// sifirlanmaz (pencerede sinir kadar kod denemesi, siparis sayisindan bagimsiz). Kullanici basina
// sayac, pencere sonu ve rota etiketleri ratelimit_test.go'da; burada yalniz dongunun hesabi.

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
)

// qaRequiredEnv, varsayilani olmayan zorunlu degiskenler (MOCK: depo adresleri istenmez; sirlar
// test icin calisma aninda uretilen sahte degerler). Hiz siniri degiskenleri VERILMEZ: varsayilan.
var qaRequiredEnv = map[string]string{
	"ASSET_BASE_URL":        "http://localhost:5173",
	"MOCK":                  "true",
	"JWT_SECRET":            strings.Repeat("qa-jwt-", 8),
	"REALTIME_TOKEN_SECRET": strings.Repeat("qa-oda-", 8),
}

// qaProductionLimits, uretimin varsayilan sinirlari (config.Load) ve siparis siniri.
func qaProductionLimits(t *testing.T, clock *testClock) (RateLimit, int) {
	t.Helper()
	settings, err := config.Load(func(name string) string { return qaRequiredEnv[name] })
	if err != nil {
		t.Fatalf("varsayilan ayarlar okunamadi: %v", err)
	}
	limits := memoryLimits(clock, settings.RateLimitGeneral, settings.RateLimitAuth, settings.RateLimitOrder)
	return limits, settings.RateLimitOrder
}

// qaLoopApp, uretim sinirlariyla uygulama; birakma ucu da bagli. Her istegin anahtari tekil.
type qaLoopApp struct {
	t      *testing.T
	app    *fiber.App
	auth   string
	serial int
}

func qaRefreshApp(t *testing.T) (*qaLoopApp, int) {
	t.Helper()
	limits, orderLimit := qaProductionLimits(t, newTestClock())
	orders := &fakeOrders{}
	app := limitedApp(t, limits, orders, silentLogger(),
		func(deps *Deps) { deps.ReservationReleaser = orders })
	auth := bearerFor(t, testUserID)[fiber.HeaderAuthorization]
	return &qaLoopApp{t: t, app: app, auth: auth}, orderLimit
}

// call, istegi gonderir. Sinir disindaki cevap BASARI olmali (`want`): 429 disinda bir hata istegin
// kendisinin bozuldugu demektir ve olcumu gecersiz kilar. 429 ise false.
func (a *qaLoopApp) call(method, path, body string, want int) bool {
	a.t.Helper()
	a.serial++
	request := orderRequest(a.t, method, path, body, map[string]string{
		IdempotencyKeyHeader:      fmt.Sprintf("qa-yenileme-%06d", a.serial),
		fiber.HeaderAuthorization: a.auth,
	})
	response, err := a.app.Test(request)
	if err != nil {
		a.t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(a.t, response)
	if response.StatusCode == http.StatusTooManyRequests {
		return false
	}
	if response.StatusCode != want {
		a.t.Fatalf("%s %s: %d (beklenen %d ya da 429)", method, path, response.StatusCode, want)
	}
	return true
}

// qaOrderID, n'inci turun siparis kimligi (ord_ + 32 hex).
func qaOrderID(n int) string {
	return fmt.Sprintf("ord_%032x", 0xa000+n)
}

// qaRound, bir turun hangi adima kadar kabul edildigi.
type qaRound struct {
	completed  bool
	ordersSent int
	codesSent  int
}

// round, bir tur: rezervasyon, siparis, k yanlis kod, birakma. Ilk 429'da durur.
func (a *qaLoopApp) round(orderID string, wrongCodes int) qaRound {
	a.t.Helper()
	result := qaRound{}
	if !a.call(http.MethodPost, "/v1/cart/reserve", validReserveBody, http.StatusCreated) {
		return result
	}
	placeBody := strings.Replace(validPlaceBody, testOrderID, orderID, 1)
	if !a.call(http.MethodPost, "/v1/orders", placeBody, http.StatusCreated) {
		return result
	}
	result.ordersSent++
	for code := 0; code < wrongCodes; code++ {
		if !a.call(http.MethodPost, "/v1/orders/"+orderID+"/3ds", `{"challengeId":"tds_1","otp":"000000"}`, http.StatusOK) {
			return result
		}
		result.codesSent++
	}
	if !a.call(http.MethodDelete, "/v1/cart/reserve/"+orderID, "", http.StatusOK) {
		return result
	}
	result.completed = true
	return result
}

// loopUntilLimited, pencere icinde ilk reddedilen istege kadar tur kosar; toplamlar.
func (a *qaLoopApp) loopUntilLimited(wrongCodes, orderLimit int) (rounds, orders, codes int) {
	a.t.Helper()
	for n := 1; n <= 4*orderLimit; n++ {
		result := a.round(qaOrderID(n), wrongCodes)
		orders += result.ordersSent
		codes += result.codesSent
		if !result.completed {
			return rounds, orders, codes
		}
		rounds++
	}
	a.t.Fatalf("pencere icinde %d turdan sonra hala 429 yok", 4*orderLimit)
	return rounds, orders, codes
}

func TestQARefreshLoopIsBoundByPerRouteLimitsNotPerOrder(t *testing.T) {
	// Tablo (L = uretimin siparis siniri, bugun 20): tur basina k yanlis kodla pencere (1 dk) icinde
	// kac TAM tur, kac siparis ve kac kod denemesi kabul edilir. Kod denemesi tam L (3DS sayaci
	// siparisler arasi ORTAK). k>1'de yarim kalan turun siparisi de kabul edilmistir (siparis = tam
	// tur + 1); k=1'de rezervasyon sayaci once dolar.
	for _, wrongCodes := range []int{1, 2, 3} {
		t.Run(fmt.Sprintf("tur basina %d yanlis kod", wrongCodes), func(t *testing.T) {
			app, limit := qaRefreshApp(t)
			wantRounds := limit / wrongCodes
			wantOrders := wantRounds
			if wrongCodes > 1 {
				wantOrders++
			}

			rounds, orders, codes := app.loopUntilLimited(wrongCodes, limit)

			t.Logf("L=%d, k=%d: dakikada %d tam tur, %d siparis, %d kod denemesi", limit, wrongCodes, rounds, orders, codes)
			if rounds != wantRounds || orders != wantOrders || codes != limit {
				t.Errorf("k=%d: tur %d (beklenen %d), siparis %d (%d), kod %d (%d)",
					wrongCodes, rounds, wantRounds, orders, wantOrders, codes, limit)
			}
		})
	}
}

func TestQAThreeDSCounterIsSharedAcrossOrders(t *testing.T) {
	app, limit := qaRefreshApp(t)

	// Her deneme FARKLI sipariste: yine de sinirdan sonra 429 (sayac siparise bagli degil).
	for n := 1; n <= limit; n++ {
		if !app.call(http.MethodPost, "/v1/orders/"+qaOrderID(n)+"/3ds", `{"challengeId":"tds_1","otp":"000000"}`, http.StatusOK) {
			t.Fatalf("%d. deneme sinirin altinda reddedildi", n)
		}
	}
	if app.call(http.MethodPost, "/v1/orders/"+qaOrderID(limit+1)+"/3ds", `{"challengeId":"tds_1","otp":"000000"}`, http.StatusOK) {
		t.Fatal("yeni siparisin ilk denemesi de 429 olmali")
	}
}
