package httpapi

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Cihaz cerezi (T8.1): "ayni cihazdan acilmis hesap sayisi" risk sinyalinin
// anahtari. Kimligi GATEWAY uretir (dvc_ + 32 hex); istemcinin yazdigi bicim
// disi deger yok sayilir ve yenisi verilir. Cerez HttpOnly'dir: sayfadaki
// betik okuyamaz. Kayit ve giriste verilir, suresi her seferinde uzar.
//
// Sayim cihaz kimligiyle SUNUCUDA yapilir (B9): cerezi silen kullanici yeni
// bir cihaz gibi gorunur ama yeni cihazdan acilan her hesap da yine sayilir.

// DeviceCookie, cihaz cerezinin adi.
const DeviceCookie = "getir_device"

// deviceCookieMaxAge, cerezin omru: bir yil.
const deviceCookieMaxAge = 365 * 24 * time.Hour

// deviceCookies, cerezin ortama gore ayari. Secure yalnizca production'da:
// gelistirme http://localhost uzerinden calisir.
type deviceCookies struct {
	secure bool
}

// ensure, istegin cihaz kimligini doner; yoksa ya da bicim disiysa yenisini
// uretir. Her durumda cerezi cevaba yazar (sure uzar).
func (d deviceCookies) ensure(c fiber.Ctx) string {
	// Fiber'in dondurdugu metin istek tamponuna baglidir; istekten sonra
	// yasayacak (oturum kaydina yazilacak) deger kopyalanir.
	deviceID := strings.Clone(c.Cookies(DeviceCookie))
	if !ids.Valid(ids.Device, deviceID) {
		deviceID = ids.New(ids.Device)
	}
	c.Cookie(&fiber.Cookie{
		Name:     DeviceCookie,
		Value:    deviceID,
		Path:     "/",
		MaxAge:   int(deviceCookieMaxAge / time.Second),
		HTTPOnly: true,
		SameSite: fiber.CookieSameSiteLaxMode,
		Secure:   d.secure,
	})
	return deviceID
}
