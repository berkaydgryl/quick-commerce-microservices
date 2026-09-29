package persona

import (
	"errors"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Risk kurallarinin esikleri (risk-service config/constants.ts). Personalarin
// verisi bu esiklerin DOGRU tarafinda durmali; biri kayarsa persona bandindan
// kayar ve demo sessizce bozulur. Esik risk-svc'de degisirse burasi da degisir.
const (
	newAccountMaxAge    = 24 * time.Hour
	geofenceMaxKm       = 50.0
	maxAccountsOnDevice = 3
)

// home, hazir "Ev" adresi (Kadikoy): personalar siparisi buraya verir.
var home = auth.GeoPoint{Lat: 40.9885, Lng: 29.0262}

func loadSet(t *testing.T) Set {
	t.Helper()
	set, err := Load()
	if err != nil {
		t.Fatalf("persona dosyasi gecersiz: %v", err)
	}
	return set
}

func accountOf(t *testing.T, set Set, name string) Account {
	t.Helper()
	for _, account := range set.Accounts {
		if account.Persona == name {
			return account
		}
	}
	t.Fatalf("%s personasi yok", name)
	return Account{}
}

func TestSelectablePersonasCoverEveryBand(t *testing.T) {
	set := loadSet(t)
	var bands []string
	for _, account := range set.Accounts {
		if account.Selectable {
			bands = append(bands, account.Persona+":"+account.Band)
		}
	}
	want := []string{"Ayşe:LOW", "Zeynep:MEDIUM", "Can:HIGH", "Ali:CRITICAL", "Komşu:LOW"}
	if len(bands) != len(want) {
		t.Fatalf("secicide bes persona olmali: %v", bands)
	}
	for i := range want {
		if bands[i] != want[i] {
			t.Errorf("%d. persona %q olmali, %q geldi", i+1, want[i], bands[i])
		}
	}
}

func TestPersonaSignalsSitOnTheIntendedSideOfEachThreshold(t *testing.T) {
	set := loadSet(t)
	devices := map[string]int{}
	for _, account := range set.Accounts {
		devices[account.RegistrationDeviceID]++
	}

	cases := []struct {
		persona     string
		newAccount  bool // account-age tetiklenmeli mi?
		farFromHome bool // geofence tetiklenmeli mi?
		sharedDev   bool // ip-device vetosu tetiklenmeli mi?
	}{
		{"Ayşe", false, false, false},
		{"Zeynep", true, false, false},
		{"Can", true, true, false},
		{"Ali", false, true, true},
		{"Komşu", false, false, false},
	}
	for _, tc := range cases {
		account := accountOf(t, set, tc.persona)
		age := time.Duration(account.AgeHours) * time.Hour
		if (age < newAccountMaxAge) != tc.newAccount {
			t.Errorf("%s: hesap yasi %v; yeni hesap sinyali %v olmali", tc.persona, age, tc.newAccount)
		}
		if account.LastLocation == nil {
			t.Fatalf("%s: son konum yok", tc.persona)
		}
		km := distanceKm(home, auth.GeoPoint{Lat: account.LastLocation.Lat, Lng: account.LastLocation.Lng})
		if (km > geofenceMaxKm) != tc.farFromHome {
			t.Errorf("%s: Ev adresine %.0f km; sehir farki sinyali %v olmali", tc.persona, km, tc.farFromHome)
		}
		if shared := devices[account.RegistrationDeviceID] >= maxAccountsOnDevice; shared != tc.sharedDev {
			t.Errorf("%s: cihazdan %d hesap; veto %v olmali", tc.persona, devices[account.RegistrationDeviceID], tc.sharedDev)
		}
	}
	if got := devices[accountOf(t, set, "Ali").RegistrationDeviceID]; got != 4 {
		t.Errorf("Ali'nin cihazindan 4 hesap acilmis olmali (risk testiyle ayni), %d", got)
	}
}

func TestUsersAreRelativeToNowAndCarryAddresses(t *testing.T) {
	set := loadSet(t)
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)

	users := set.Users(now, "$2a$04$ozet")

	for i, user := range users {
		account := set.Accounts[i]
		if user.ID != account.ID || user.PasswordHash != "$2a$04$ozet" || user.RegistrationDeviceID != account.RegistrationDeviceID ||
			!user.CreatedAt.Equal(now.Add(-time.Duration(account.AgeHours)*time.Hour)) || user.LastLoginIP != "" {
			t.Errorf("%s: kayit hesaptan birebir kurulmali: %+v", account.Persona, user)
		}
		if account.WithAddresses && len(user.Addresses) != 3 || !account.WithAddresses && len(user.Addresses) != 0 {
			t.Errorf("%s: adres sayisi %d", account.Persona, len(user.Addresses))
		}
	}
	// Adres dilimleri paylasilmaz: bir hesabin adresini degistirmek digerini bozmasin.
	users[0].Addresses[0].Title = "degisti"
	if users[1].Addresses[0].Title == "degisti" {
		t.Error("hesaplar ayni adres dilimini paylasmamali")
	}
}

func TestDemoAddressesMatchTheRoadmapTable(t *testing.T) {
	// Ev ve Is marketlerin yaricapinda, Yazlik hicbirinin (NO_STORE); konumlar
	// catalog'un entegrasyon testinde de dogrulanir (demo-addresses.ts).
	set := loadSet(t)
	titles := []string{}
	for _, address := range set.Addresses {
		titles = append(titles, address.Title)
	}
	if len(titles) != 3 || titles[0] != "Ev" || titles[1] != "İş" || titles[2] != "Yazlık" {
		t.Errorf("hazir adresler Ev, İş, Yazlık olmali: %v", titles)
	}
}

func TestPersonasNeverLoadInProduction(t *testing.T) {
	if err := Allowed("production"); !errors.Is(err, ErrProduction) {
		t.Errorf("production reddedilmeli: %v", err)
	}
	for _, env := range []string{"development", "test"} {
		if err := Allowed(env); err != nil {
			t.Errorf("%s'te yuklenebilmeli: %v", env, err)
		}
	}
}

// distanceKm, iki nokta arasi buyuk daire mesafesi (risk-svc geofence ile ayni formul).
func distanceKm(a, b auth.GeoPoint) float64 {
	const earthRadiusKm = 6371.0
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat, dLng := toRad(b.Lat-a.Lat), toRad(b.Lng-a.Lng)
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(toRad(a.Lat))*math.Cos(toRad(b.Lat))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Sqrt(h))
}

// riskConstantsPath, risk kurallarinin esikleri (tek kaynak).
const riskConstantsPath = "../../../risk-service/src/config/constants.ts"

func TestThresholdsMatchRiskService(t *testing.T) {
	// Yukaridaki esikler risk-svc'nin kopyasidir; risk-svc'de degisip burada
	// unutulursa persona testi yanlis esikle yesil kalirdi.
	raw, err := os.ReadFile(riskConstantsPath)
	if err != nil {
		t.Fatalf("risk sabitleri okunamadi: %v", err)
	}
	source := string(raw)
	for name, want := range map[string]float64{
		"NEW_ACCOUNT_MAX_AGE_MS":   float64(newAccountMaxAge / time.Millisecond),
		"GEOFENCE_MAX_DISTANCE_KM": geofenceMaxKm,
		"MAX_ACCOUNTS_PER_DEVICE":  maxAccountsOnDevice,
	} {
		match := regexp.MustCompile(`export const ` + name + ` = ([0-9_ *]+);`).FindStringSubmatch(source)
		if match == nil {
			t.Errorf("%s risk sabitlerinde bulunamadi", name)
			continue
		}
		if got := product(t, match[1]); got != want {
			t.Errorf("%s: risk-svc %v, persona testi %v", name, got, want)
		}
	}
}

// product, "24 * 60 * 60 * 1000" gibi carpimi hesaplar (alt cizgili sayilar dahil).
func product(t *testing.T, expression string) float64 {
	t.Helper()
	result := 1.0
	for _, part := range strings.Split(expression, "*") {
		value, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(part), "_", ""), 64)
		if err != nil {
			t.Fatalf("sabit okunamadi (%q): %v", expression, err)
		}
		result *= value
	}
	return result
}

// orderHistoryPath, personalarin siparis gecmisi (order-service, ADR-05).
const orderHistoryPath = "../../../order-service/src/infrastructure/fixtures/persona-orders.ts"

func TestOrderServiceHistoryUsesTheSamePersonaIDs(t *testing.T) {
	// Hesaplari gateway, siparis gecmisini order-service yazar; iki dosya ayni
	// kimlikleri tasimali. Biri degisip digeri unutulursa personanin gecmisi
	// bos gorunur ve bandi sessizce kayar.
	raw, err := os.ReadFile(orderHistoryPath)
	if err != nil {
		t.Fatalf("order-service persona dosyasi okunamadi: %v", err)
	}
	orderSide := map[string]bool{}
	for _, match := range regexp.MustCompile(`userId: '(usr_[0-9a-f]{32})'`).FindAllStringSubmatch(string(raw), -1) {
		orderSide[match[1]] = true
	}

	set := loadSet(t)
	gatewaySide := map[string]bool{}
	for _, account := range set.Accounts {
		if account.Selectable {
			gatewaySide[account.ID] = true
		}
	}
	if len(orderSide) != len(gatewaySide) {
		t.Fatalf("iki tarafta ayni sayida persona olmali: order %d, gateway %d", len(orderSide), len(gatewaySide))
	}
	for id := range gatewaySide {
		if !orderSide[id] {
			t.Errorf("%s order-service gecmisinde yok", id)
		}
	}
}
