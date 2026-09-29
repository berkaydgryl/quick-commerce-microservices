package idempotency

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Anahtar bicimi @getir/redis-kit keys.ts'te tanimlidir (tek kaynak); yazan tek
// taraf gateway'dir. Go TypeScript okuyamaz: bu test keys.ts'i metin olarak
// okuyup Key ve AnonymousScope ile karsilastirir. Biri degisip digeri
// unutulursa kirmizi olur.

const redisKitKeysPath = "../../../../packages/redis-kit/src/keys.ts"

func readKeysSource(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile(redisKitKeysPath)
	if err != nil {
		t.Fatalf("redis-kit anahtar kaynagi okunamadi (%s): %v", redisKitKeysPath, err)
	}
	return string(source)
}

func TestKeyMatchesRedisKit(t *testing.T) {
	source := readKeysSource(t)

	// keys.ts: idempotencyKey(scope, key) -> `idem:${hashTag(scope)}:${key}`,
	// hashTag(value) -> `{${value}}`. Ikisi yerine konunca Key'in sonucu cikar.
	function := regexp.MustCompile("(?s)export function idempotencyKey\\(scope: string, key: string\\): string \\{.*?return `([^`]+)`;").FindStringSubmatch(source)
	if function == nil {
		t.Fatal("keys.ts'te idempotencyKey(scope, key) bulunamadi; imza degistiyse bu testi de guncelle")
	}
	hashTag := regexp.MustCompile("export function hashTag\\(value: string\\): string \\{\\s*return `([^`]+)`;").FindStringSubmatch(source)
	if hashTag == nil {
		t.Fatal("keys.ts'te hashTag bulunamadi")
	}
	tagged := strings.ReplaceAll(hashTag[1], "${value}", "usr_7")
	expected := strings.NewReplacer("${hashTag(scope)}", tagged, "${key}", "4f1c3a2b-9d8e").Replace(function[1])

	if got := Key("usr_7", "4f1c3a2b-9d8e"); got != expected {
		t.Errorf("anahtar bicimi ayrisiyor: redis-kit %q, gateway %q", expected, got)
	}
}

func TestAnonymousScopeMatchesRedisKit(t *testing.T) {
	match := regexp.MustCompile(`export const IDEMPOTENCY_ANONYMOUS_SCOPE = '([^']+)';`).FindStringSubmatch(readKeysSource(t))
	if match == nil || match[1] != AnonymousScope {
		t.Errorf("anonim kapsam ayrisiyor: redis-kit %v, gateway %q", match, AnonymousScope)
	}
}
