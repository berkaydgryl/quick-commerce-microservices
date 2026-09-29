package httpapi

import (
	"net/http"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Cihaz cerezi ve siparis sinyalleri (T8.1) GERCEK kimlik servisiyle: kayit ve
// giris oturuma cihazi ve onceki IP'yi yazar, siparis onlari okur. Siparis
// servisi sahtedir (fakeOrders): sinana, ona giden sinyallerdir.

func signalsApp(t *testing.T, secureCookies bool) (*fiber.App, *fakeOrders) {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici kurulamadi: %v", err)
	}
	service := auth.NewService(auth.Deps{
		Users:      authstore.NewMemoryUsers(),
		Sessions:   authstore.NewMemorySessions(),
		Passwords:  passwords,
		Tokens:     testTokens(),
		Locator:    auth.NoLocator{},
		RefreshTTL: testRefresh,
		Now:        time.Now,
	})
	orders := &fakeOrders{}
	return New(Deps{
		Health:            fakeReporter{report: healthyReport()},
		UserRegistrar:     service,
		UserAuthenticator: service,
		SessionRefresher:  service,
		SessionRevoker:    service,
		ProfileGetter:     service,
		CheckoutSignals:   service,
		OrderPlacer:       orders,
		AccessTokens:      testTokens(),
		Idempotency:       testIdempotency(),
		SecureCookies:     secureCookies,
		Logger:            silentLogger(),
	}), orders
}

// deviceCookieOf, cevaptaki cihaz cerezi; yoksa testi durdurur.
func deviceCookieOf(t *testing.T, header http.Header) *http.Cookie {
	t.Helper()
	for _, line := range header.Values(fiber.HeaderSetCookie) {
		cookie, err := http.ParseSetCookie(line)
		if err != nil {
			t.Fatalf("Set-Cookie cozulemedi (%q): %v", line, err)
		}
		if cookie.Name == DeviceCookie {
			return cookie
		}
	}
	t.Fatalf("cihaz cerezi yazilmadi: %v", header.Values(fiber.HeaderSetCookie))
	return nil
}

// withDevice, istege cihaz cerezini ekler.
func withDevice(request *http.Request, deviceID string) *http.Request {
	request.AddCookie(&http.Cookie{Name: DeviceCookie, Value: deviceID})
	return request
}

func registerOn(t *testing.T, app *fiber.App, deviceID, phone string) (auth.Grant, *http.Cookie) {
	t.Helper()
	request := registerRequest(t, registerBodyOf(phone, testPassword, testFullName))
	if deviceID != "" {
		withDevice(request, deviceID)
	}
	status, header, envelope := exchange(t, app, request)
	if status != http.StatusCreated {
		t.Fatalf("kayit 201 donmeli: %d %+v", status, envelope)
	}
	return dataOf[auth.Grant](t, envelope), deviceCookieOf(t, header)
}

func placeWith(t *testing.T, app *fiber.App, accessToken string) (int, Envelope) {
	t.Helper()
	return send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody,
		map[string]string{fiber.HeaderAuthorization: bearerScheme + " " + accessToken}))
}

func TestRegisterIssuesHTTPOnlyDeviceCookie(t *testing.T) {
	app, _ := signalsApp(t, false)

	_, cookie := registerOn(t, app, "", testPhone)

	if !ids.Valid(ids.Device, cookie.Value) || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode ||
		cookie.Path != "/" || cookie.MaxAge != int(deviceCookieMaxAge/time.Second) || cookie.Secure {
		t.Errorf("dvc_ bicimli, HttpOnly, Lax, 1 yillik ve gelistirmede Secure'suz cerez bekleniyordu: %+v", cookie)
	}
}

func TestProductionDeviceCookieIsSecure(t *testing.T) {
	app, _ := signalsApp(t, true)

	_, cookie := registerOn(t, app, "", testPhone)

	if !cookie.Secure {
		t.Errorf("production'da cerez Secure olmali: %+v", cookie)
	}
}

func TestLoginKeepsValidDeviceAndReplacesForgedOne(t *testing.T) {
	app, _ := signalsApp(t, false)
	_, issued := registerOn(t, app, "", testPhone)

	for name, tc := range map[string]struct {
		sent string
		keep bool
	}{
		"gecerli cerez korunur":         {sent: issued.Value, keep: true},
		"bicim disi cerez degistirilir": {sent: "dvc_elle-yazilmis", keep: false},
	} {
		request := withDevice(jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil), tc.sent)
		status, header, envelope := exchange(t, app, request)
		if status != http.StatusOK {
			t.Fatalf("%s: giris 200 donmeli: %d %+v", name, status, envelope)
		}
		got := deviceCookieOf(t, header).Value
		if (got == tc.sent) != tc.keep || !ids.Valid(ids.Device, got) {
			t.Errorf("%s: gonderilen %q, donen %q", name, tc.sent, got)
		}
	}
}

func TestOrderCarriesSessionSignals(t *testing.T) {
	app, orders := signalsApp(t, false)
	registered, device := registerOn(t, app, "", testPhone)

	// Ayni cihazdan giris: oturuma cihaz ve onceki girisin (kaydin) IP'si yazilir.
	request := withDevice(jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil), device.Value)
	status, _, envelope := exchange(t, app, request)
	if status != http.StatusOK {
		t.Fatalf("giris 200 donmeli: %d %+v", status, envelope)
	}
	loggedIn := dataOf[auth.Grant](t, envelope)

	if status, envelope := placeWith(t, app, loggedIn.AccessToken); status != http.StatusCreated {
		t.Fatalf("siparis 201 donmeli: %d %+v", status, envelope)
	}

	signals := orders.placeInput.Signals
	if signals.DeviceID != device.Value || signals.AccountsOnDevice != 1 || signals.IPAddress == "" {
		t.Errorf("cihaz, cihazdaki hesap sayisi (1) ve IP tasinmali: %+v", signals)
	}
	// Kayit ve giris ayni baglantidan: onceki IP bugunkuyle ayni, "IP degisimi" yok.
	if signals.PreviousIPAddress != signals.IPAddress {
		t.Errorf("onceki IP kaydin IP'si olmali: onceki %q, simdiki %q", signals.PreviousIPAddress, signals.IPAddress)
	}
	if signals.SessionLocation != nil || signals.IPCity != "" {
		t.Errorf("konum cozucusu yokken ve son konum bilinmezken konum gonderilmemeli: %+v", signals)
	}
	if age := time.Since(signals.AccountCreatedAt); age < 0 || age > time.Minute {
		t.Errorf("hesap yasi kayit anindan olmali: %v", signals.AccountCreatedAt)
	}
	if registered.User.ID != orders.placeInput.UserID {
		t.Errorf("siparis jetondaki kullaniciyla gitmeli: %q", orders.placeInput.UserID)
	}
}

func TestThirdAccountFromOneDeviceIsCounted(t *testing.T) {
	// Ayni cihazdan uc hesap: ucuncusunun siparisinde cihazdaki hesap sayisi 3
	// (risk-svc'de kesin kural, veto). Hesaplar sonradan baska cihazdan girse
	// de sayi degismez: sayim hesabin ACILDIGI cihaza gore.
	app, orders := signalsApp(t, false)
	_, device := registerOn(t, app, "", "+905321230001")
	registerOn(t, app, device.Value, "+905321230002")
	third, _ := registerOn(t, app, device.Value, "+905321230003")

	if status, envelope := placeWith(t, app, third.AccessToken); status != http.StatusCreated {
		t.Fatalf("siparis 201 donmeli: %d %+v", status, envelope)
	}

	if got := orders.placeInput.Signals.AccountsOnDevice; got != 3 {
		t.Errorf("cihazdan acilan hesap sayisi 3 olmali, %d geldi", got)
	}
}

func TestOrderAfterLogoutIsUnauthorized(t *testing.T) {
	// Cikistan sonra erisim jetonu suresi (JWT_TTL) dolana kadar gecerlidir; ama
	// oturumu kapanmis jetonla siparis verilemez.
	app, orders := signalsApp(t, false)
	registered, _ := registerOn(t, app, "", testPhone)
	if status, _ := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/logout", refreshBodyOf(registered.RefreshToken), nil)); status != http.StatusOK {
		t.Fatalf("cikis 200 donmeli: %d", status)
	}

	status, envelope := placeWith(t, app, registered.AccessToken)

	if status != http.StatusUnauthorized || envelope.Error.Code != apperror.CodeUnauthorized || detailsOf(t, envelope)[fiber.HeaderAuthorization] == nil {
		t.Errorf("cikistan sonra siparis 401 donmeli: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("kapanmis oturumla siparis servisi cagrilmamaliydi")
	}
	// Jeton hala gecerli: yalnizca siparis kapali.
	if status, _ := send(t, app, jsonRequest(t, http.MethodGet, "/v1/me", "", map[string]string{fiber.HeaderAuthorization: bearerScheme + " " + registered.AccessToken})); status != http.StatusOK {
		t.Errorf("profil jeton suresince okunabilmeli: %d", status)
	}
}
