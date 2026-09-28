package httpapi

import (
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Kullanici kimligi (T7.5). JWT dogrulamasi T8.1'de gelir; o zamana kadar
// GELISTIRME ve TEST ortaminda istemci kimligini X-User-Id basligiyla bildirir.
//
// PRODUCTION'DA BU BASLIK OKUNMAZ: kimlik dogrulamasi olmadan herkes kendini
// baska biri gibi tanitabilirdi. Production'da korumali uclar T8.1'e kadar
// 401 doner.
//
// Kimligi belirleyen TEK yer bu ara katmandir; handler'lar userIDOf(c) okur.
// T8.1'de yalnizca bu dosya degisir (JWT), uclar degismez.

// UserIDHeader, gelistirmede kullanici kimliginin tasindigi baslik.
const UserIDHeader = "X-User-Id"

const userIDLocal = "userId"

const userIDReason = "gecerli bir kullanici kimligi olmali (usr_...)"

// userIDPattern, demo kimligi: persona ve test kullanicilari ("usr_ali",
// "usr_1"). Bicim kimligin kendisini degil, basliga rastgele metin
// yazilmasini sinirlar.
var userIDPattern = regexp.MustCompile(`^usr_[A-Za-z0-9_-]{1,64}$`)

// requireUser, korumali uclarin kimlik ara katmani. allowDemoHeader yalnizca
// production DISINDA true'dur (bkz. bootstrap).
func requireUser(allowDemoHeader bool) fiber.Handler {
	return func(c fiber.Ctx) error {
		if !allowDemoHeader {
			return apperror.New(apperror.CodeUnauthorized, nil)
		}
		userID := strings.TrimSpace(c.Get(UserIDHeader))
		if !userIDPattern.MatchString(userID) {
			return apperror.New(apperror.CodeUnauthorized, map[string]string{UserIDHeader: userIDReason})
		}
		c.Locals(userIDLocal, userID)
		return c.Next()
	}
}

// userIDOf, requireUser'in koydugu kimlik. Ara katmandan gecmeyen istekte bos.
func userIDOf(c fiber.Ctx) string {
	if userID, ok := c.Locals(userIDLocal).(string); ok {
		return userID
	}
	return ""
}
