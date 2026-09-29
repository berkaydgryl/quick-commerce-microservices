package ratelimit

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Anahtar bicimi @getir/redis-kit keys.ts'te tanimlidir (tek kaynak); yazan tek
// taraf gateway'dir. Go TypeScript okuyamaz: bu test keys.ts'i metin olarak
// okuyup Key ile karsilastirir (idempotency paketindeki testle ayni yontem).

const redisKitKeysPath = "../../../../packages/redis-kit/src/keys.ts"

func TestKeyMatchesRedisKit(t *testing.T) {
	raw, err := os.ReadFile(redisKitKeysPath)
	if err != nil {
		t.Fatalf("redis-kit anahtar kaynagi okunamadi (%s): %v", redisKitKeysPath, err)
	}
	source := string(raw)

	// keys.ts: rateLimitKey(subject, route) -> `rate:${hashTag(subject)}:${route}`,
	// hashTag(value) -> `{${value}}`.
	function := regexp.MustCompile("(?s)export function rateLimitKey\\(subject: string, route: string\\): string \\{.*?return `([^`]+)`;").FindStringSubmatch(source)
	if function == nil {
		t.Fatal("keys.ts'te rateLimitKey(subject, route) bulunamadi; imza degistiyse bu testi de guncelle")
	}
	hashTag := regexp.MustCompile("export function hashTag\\(value: string\\): string \\{\\s*return `([^`]+)`;").FindStringSubmatch(source)
	if hashTag == nil {
		t.Fatal("keys.ts'te hashTag bulunamadi")
	}
	tagged := strings.ReplaceAll(hashTag[1], "${value}", "10.0.0.1")
	expected := strings.NewReplacer("${hashTag(subject)}", tagged, "${route}", "POST_/v1/orders").Replace(function[1])

	if got := Key("10.0.0.1", "POST_/v1/orders"); got != expected {
		t.Errorf("anahtar bicimi ayrisiyor: redis-kit %q, gateway %q", expected, got)
	}
}
