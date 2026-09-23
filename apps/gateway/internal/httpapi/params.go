package httpapi

import (
	"math"
	"strconv"

	"github.com/gofiber/fiber/v3"
)

// Sorgu parametresini TIPINE ceviren yardimcilar. Yalnizca BICIM burada
// dogrulanir ("sayi mi?"); ARALIK kurallari (enlem -90..90, arama en az 2
// karakter, sayfa boyu kirpma) catalog-service'tedir ve hatasi details ile
// geri gelir. Kural iki yerde yazilirsa bir gun ayrisir.

const (
	requiredReason = "zorunlu"
	numberReason   = "sayi olmali"
	integerReason  = "tam sayi olmali"
)

// fieldErrors, bir istekteki tum bicim hatalarini toplar: istemci ilk hatada
// durup tek tek duzeltmek yerine hepsini bir kerede gorur.
type fieldErrors map[string]string

// requiredFloat, zorunlu sonlu ondalik sayi. NaN ve sonsuz BICIM hatasidir:
// servis semasi da reddeder ama anlamsiz degeri gRPC'ye tasimanin nedeni yok.
func requiredFloat(c fiber.Ctx, name string, errs fieldErrors) float64 {
	raw := c.Query(name)
	if raw == "" {
		errs[name] = requiredReason
		return 0
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		errs[name] = numberReason
		return 0
	}
	return value
}

// optionalInt32, verilmezse 0 (servis varsayilani uygular).
func optionalInt32(c fiber.Ctx, name string, errs fieldErrors) int32 {
	raw := c.Query(name)
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		errs[name] = integerReason
		return 0
	}
	return int32(value)
}
