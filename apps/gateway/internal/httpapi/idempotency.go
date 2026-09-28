package httpapi

import (
	"strings"

	"github.com/gofiber/fiber/v3"
)

// IdempotencyKeyHeader, mutasyon uclarinin zorunlu basligi (ADR-08).
const IdempotencyKeyHeader = "Idempotency-Key"

// idempotencyKeyOf, anahtari okur; yoksa sebebi errs'e yazar.
//
// Gateway yalnizca VARLIGINI dogrular ("anahtarsiz mutasyon 400", ADR-08).
// Uzunluk kurali order-service'tedir (contracts idempotencyKeySchema, 8-128)
// ve hatasi details'te bu basligin adiyla doner. Ayni anahtarla gelen ikinci
// istegin ilk cevabi almasi (tekrar korumasi, idem:{key}) T8.2'dedir.
func idempotencyKeyOf(c fiber.Ctx, errs fieldErrors) string {
	key := strings.TrimSpace(c.Get(IdempotencyKeyHeader))
	if key == "" {
		errs[IdempotencyKeyHeader] = requiredReason
	}
	return key
}
