package roomtoken

import (
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Jetonun alanlari iki tarafta yazilidir: @getir/contracts socket.ts
// (realtime-service dogrularken kullanir) ve bu paket (gateway imzalarken).
// Biri degisip digeri unutulursa realtime her jetonu reddeder; bu test o
// ayrismayi derlemede degil burada, kirmizi olarak gosterir.

const contractSocketPath = "../../../../packages/contracts/src/socket.ts"

// objectBlock, `export const AD = { ... } as const;` blogunun icini doner.
func objectBlock(t *testing.T, source, name string) string {
	t.Helper()
	match := regexp.MustCompile(`(?s)export const ` + name + ` = \{(.*?)\} as const;`).FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("%s sozlesmede bulunamadi", name)
	}
	return match[1]
}

// field, bloktaki `ALAN: 'deger',` ya da `ALAN: 60,` satirinin degeri.
func field(t *testing.T, block, name string) string {
	t.Helper()
	match := regexp.MustCompile(`(?m)^\s*` + name + `: '?([^',]+)'?,`).FindStringSubmatch(block)
	if match == nil {
		t.Fatalf("%s alani sozlesmede bulunamadi", name)
	}
	return match[1]
}

func TestTokenConstantsMatchContract(t *testing.T) {
	block := objectBlock(t, testkit.ReadContract(t, contractSocketPath), "REALTIME_TOKEN")

	for name, goValue := range map[string]string{
		"ALGORITHM":  Algorithm,
		"ISSUER":     Issuer,
		"AUDIENCE":   Audience,
		"ROOM_CLAIM": RoomClaim,
	} {
		if contractValue := field(t, block, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %q, gateway %q", name, contractValue, goValue)
		}
	}
	seconds, err := strconv.Atoi(field(t, block, "TTL_SECONDS"))
	if err != nil {
		t.Fatalf("TTL_SECONDS sayi degil: %v", err)
	}
	if time.Duration(seconds)*time.Second != TTL {
		t.Errorf("TTL_SECONDS: sozlesme %d sn, gateway %v", seconds, TTL)
	}
}

func TestOrderRoomPrefixMatchesContract(t *testing.T) {
	block := objectBlock(t, testkit.ReadContract(t, testkit.ContractConstantsPath), "ROOM_PREFIX")
	if prefix := field(t, block, "order"); prefix != orderRoomPrefix {
		t.Errorf("ROOM_PREFIX.order: sozlesme %q, gateway %q", prefix, orderRoomPrefix)
	}
}
