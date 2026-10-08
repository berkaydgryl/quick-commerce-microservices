package order

import (
	"encoding/json"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// 3DS durumunun (#163 B1) iki kopyasi: @getir/contracts order-three-ds.ts ve
// openapi ornekleri (web) ile bu paket. Biri degisip digeri unutulursa kirmizi.

const (
	contractOrderThreeDSPath = "../../../../packages/contracts/src/order-three-ds.ts"
	openAPIPath              = "../../../../docs/api/openapi.yaml"
)

func TestThreeDSChallengeIDRuleMatchesContract(t *testing.T) {
	// threeDsChallengeIdSchema: `^${ID_PREFIX.THREEDS_CHALLENGE}_[0-9a-f]{32}$`; onek core'dan.
	prefix := testkit.StringRecord(t, testkit.ReadContract(t, testkit.CoreIDPath), "ID_PREFIX")["THREEDS_CHALLENGE"]
	match := regexp.MustCompile("threeDsChallengeIdSchema = z\\s*\\.string\\(\\)\\s*\\.regex\\(new RegExp\\(`([^`]*)`\\)").
		FindStringSubmatch(testkit.ReadContract(t, contractOrderThreeDSPath))
	if match == nil || prefix == "" {
		t.Fatal("threeDsChallengeIdSchema ya da ID_PREFIX.THREEDS_CHALLENGE sozlesmede bulunamadi")
	}
	if pattern := strings.ReplaceAll(match[1], "${ID_PREFIX.THREEDS_CHALLENGE}", prefix); pattern != threeDSChallengeIDPattern {
		t.Errorf("threeDsChallengeIdSchema: sozlesme %q, gateway %q", pattern, threeDSChallengeIDPattern)
	}
}

func TestThreeDSOpenAndClosedMinimumsMatchContract(t *testing.T) {
	// Acik: ttlSeconds ve attemptsLeft min(1) (gateway'in acik siniri); kapali: min(0).
	source := testkit.ReadContract(t, contractOrderThreeDSPath)
	for schema, want := range map[string]int{"openOrderThreeDsSchema": threeDSOpenMinimum, "closedOrderThreeDsSchema": 0} {
		body := regexp.MustCompile(`(?s)export const ` + schema + ` = z\.object\(\{(.*?)\n\}\);`).FindStringSubmatch(source)
		if body == nil {
			t.Fatalf("%s sozlesmede bulunamadi", schema)
		}
		for _, field := range []string{"ttlSeconds", "attemptsLeft"} {
			minimum := regexp.MustCompile(field + `: z\.number\(\)\.int\(\)\.min\((\d+)\)`).FindStringSubmatch(body[1])
			if minimum == nil {
				t.Fatalf("%s.%s sozlesmede bulunamadi", schema, field)
			}
			if got, err := strconv.Atoi(minimum[1]); err != nil || got != want {
				t.Errorf("%s.%s alt siniri: sozlesme %s, gateway %d", schema, field, minimum[1], want)
			}
		}
	}
}

// openAPIThreeDS, getOrder ornegindeki `threeDs` degeri (akis eslemesi:
// `{ ttlSeconds: 0, attemptsLeft: 2 }`); ornekte alan yoksa nil.
func openAPIThreeDS(t *testing.T, source, example string) map[string]any {
	t.Helper()
	start := strings.Index(source, "                "+example+":\n")
	if start < 0 {
		t.Fatalf("openapi ornegi %s bulunamadi", example)
	}
	block := source[start+len(example)+18:]
	if end := regexp.MustCompile(`\n {0,16}\S`).FindStringIndex(block); end != nil {
		block = block[:end[0]]
	}
	at := strings.Index(block, "threeDs:")
	if at < 0 {
		return nil
	}
	mapping := block[at:]
	mapping = mapping[strings.Index(mapping, "{")+1 : strings.Index(mapping, "}")]
	values := map[string]any{}
	for _, pair := range regexp.MustCompile(`(\w+):\s*(?:"([^"]*)"|(-?\d+))`).FindAllStringSubmatch(mapping, -1) {
		if pair[3] != "" {
			number, err := strconv.ParseFloat(pair[3], 64)
			if err != nil {
				t.Fatalf("%s.%s sayi degil: %v", example, pair[1], err)
			}
			values[pair[1]] = number
			continue
		}
		values[pair[1]] = pair[2]
	}
	return values
}

func TestThreeDSMatchesOpenAPIExamples(t *testing.T) {
	// Ornekteki durumu ureten payment girdisi gateway'den gecer; cikti ornegin
	// AYNISI olmali. Kapali orneklerde payment jeton gonderse de atilir.
	source := testkit.ReadContract(t, openAPIPath)
	for _, tc := range []struct {
		example string
		status  *paymentv1.ThreeDsStatus
	}{
		{"threeDsOpen", threeDSStatus(testChallengeID, 42*time.Second+500*time.Millisecond, 2)},
		{"threeDsExpired", threeDSStatus(testChallengeID, 0, 2)},
		{"threeDsExhausted", threeDSStatus(testChallengeID, 31*time.Second, 0)},
		{"threeDsUnknown", nil},
	} {
		t.Run(tc.example, func(t *testing.T) {
			want := openAPIThreeDS(t, source, tc.example)
			view := toOrderThreeDS(tc.status, orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT, threeDSNow)
			if view == nil || want == nil {
				if (view == nil) != (want == nil) {
					t.Errorf("ornek %v, gateway %+v", want, view)
				}
				return
			}
			var got map[string]any
			if err := json.Unmarshal([]byte(testkit.JSON(t, view)), &got); err != nil {
				t.Fatalf("gateway cevabi cozulemedi: %v", err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("ornek %v, gateway %v", want, got)
			}
		})
	}
}
