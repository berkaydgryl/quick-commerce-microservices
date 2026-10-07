package tracking

import (
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Takip cevabinin iki kopyasi vardir: @getir/contracts tracking.ts (web ve
// courier) ve bu paket. Asama adlari, takip edilen durumlar ve cevabin alanlari
// (istege bagli olanlar dahil) ayrilirsa web'in semasi gateway'in cevabini
// reddederdi; burada kirmizi olur.

const contractTrackingPath = "../../../../packages/contracts/src/tracking.ts"

func TestPhasesMatchContract(t *testing.T) {
	source := testkit.ReadContract(t, contractTrackingPath)
	want := []string{PhaseToMarket, PhaseToCustomer, PhaseDelivered}

	if contract := testkit.StringEnum(t, source, "trackingPhaseSchema"); !slices.Equal(contract, want) {
		t.Errorf("trackingPhaseSchema: sozlesme %v, gateway %v", contract, want)
	}
}

func TestTrackingConstantsMatchContract(t *testing.T) {
	source := testkit.ReadContract(t, contractTrackingPath)
	for name, goValue := range map[string]int{
		"COURIER_ROUTE_MAX_POINTS":                RouteMaxPoints,
		"TRACKING_ETA_STEP_BEFORE_PICKUP_SECONDS": EtaStepBeforePickupSeconds,
	} {
		if contractValue := testkit.NumberConstant(t, source, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
}

func TestTrackedStatusesMatchContract(t *testing.T) {
	// Sema ORDER_STATUS.X adlarini kullanir (z.enum([ORDER_STATUS.PREPARING, ...])).
	source := testkit.ReadContract(t, contractTrackingPath)
	block := regexp.MustCompile(`(?s)export const trackedOrderStatusSchema = z\.enum\(\[(.*?)\]\);`).FindStringSubmatch(source)
	if block == nil {
		t.Fatal("trackedOrderStatusSchema sozlesmede bulunamadi")
	}
	contract := []string{}
	for _, match := range regexp.MustCompile(`ORDER_STATUS\.([A-Z_]+)`).FindAllStringSubmatch(block[1], -1) {
		contract = append(contract, match[1])
	}

	if !slices.Equal(contract, trackedStatuses) {
		t.Errorf("trackedOrderStatusSchema: sozlesme %v, gateway %v", contract, trackedStatuses)
	}
}

func TestTrackingFieldsMatchContract(t *testing.T) {
	// orderTrackingSchema'nin ust duzey alanlari (4 bosluk girintili `ad:`
	// satirlari) ve .optional() olanlar; Go tarafinda json adlari ve omitempty.
	contract := map[string]bool{}
	for _, match := range trackingSchemaFields(t) {
		contract[match[1]] = strings.Contains(match[2], ".optional()")
	}

	gateway := map[string]bool{}
	fields := reflect.TypeFor[Tracking]()
	for index := range fields.NumField() {
		name, options, _ := strings.Cut(fields.Field(index).Tag.Get("json"), ",")
		gateway[name] = options == "omitempty"
	}

	if !reflect.DeepEqual(contract, gateway) {
		t.Errorf("alanlar (ad -> istege bagli):\nsozlesme %v\ngateway  %v", contract, gateway)
	}
}

func TestTrackingNumbersHaveNoUpperBoundInContract(t *testing.T) {
	// #179 N6: EtaSeconds int64 (TO_MARKET yuvarlamasi int32 sinirinda
	// tasmasin). Sozlesmede kalan yol ve tahmin yalnizca negatif olmayan
	// tamsayidir; ust sinir (.max) yok, tasmasiz yuvarlanan en buyuk deger
	// (2147483700) semayi gecer. Go o degeri JSON'da tirnaksiz SAYI yazar.
	fields := map[string]string{}
	for _, match := range trackingSchemaFields(t) {
		fields[match[1]] = match[2]
	}
	for _, name := range []string{"remainingMeters", "etaSeconds"} {
		if rule := fields[name]; rule != "z.number().int().min(0)," {
			t.Errorf("%s: sozlesme kurali %q; gateway negatif olmayan, ust sinirsiz tamsayi bekler", name, rule)
		}
	}

	body := testkit.JSON(t, Tracking{EtaSeconds: 2147483700})
	if !strings.Contains(body, `"etaSeconds":2147483700,`) {
		t.Errorf("etaSeconds JSON'da sayi olmali: %s", body)
	}
}

// trackingSchemaFields, orderTrackingSchema'nin ust duzey alan satirlari
// (4 bosluk girintili `ad: kural`): [satir, ad, kural].
func trackingSchemaFields(t *testing.T) [][]string {
	t.Helper()
	source := testkit.ReadContract(t, contractTrackingPath)
	block := regexp.MustCompile(`(?s)export const orderTrackingSchema = z\s*\.object\(\{(.*?)\n  \}\)`).FindStringSubmatch(source)
	if block == nil {
		t.Fatal("orderTrackingSchema sozlesmede bulunamadi")
	}
	return regexp.MustCompile(`(?m)^    ([a-zA-Z]+): (.*)$`).FindAllStringSubmatch(block[1], -1)
}
