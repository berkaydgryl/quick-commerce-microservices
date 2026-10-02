package geo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

const testUserAgent = "getir-demo-test/1.0"

// fakeNominatim, Nominatim'in yerine gecen sunucu: gelen istekleri kaydeder,
// cevabi testin verdigi fonksiyon yazar.
type fakeNominatim struct {
	mu       sync.Mutex
	requests []*http.Request
	respond  func(w http.ResponseWriter, r *http.Request)
}

func (f *fakeNominatim) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.requests = append(f.requests, r)
	f.mu.Unlock()
	f.respond(w, r)
}

func (f *fakeNominatim) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func (f *fakeNominatim) last() *http.Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests[len(f.requests)-1]
}

func newTestService(t *testing.T, respond func(w http.ResponseWriter, r *http.Request)) (*Service, *fakeNominatim) {
	t.Helper()
	fake := &fakeNominatim{respond: respond}
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	base, err := url.Parse(server.URL + "/nominatim")
	if err != nil {
		t.Fatalf("adres cozulemedi: %v", err)
	}
	// Testte sira beklemesin: aralik 1 ns.
	return New(Options{BaseURL: base, UserAgent: testUserAgent, Timeout: 5 * time.Second, Interval: time.Nanosecond}), fake
}

func writeJSON(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write([]byte(body)); err != nil {
		t.Errorf("cevap yazilamadi: %v", err)
	}
}

func codeOf(err error) apperror.Code {
	var appErr *apperror.Error
	if errors.As(err, &appErr) {
		return appErr.Code
	}
	return ""
}

const reverseBody = `{"lat":"40.9884958","lon":"29.0270742","name":"Final Kursu",
  "display_name":"Final Kursu, 23, Nail Bey Sokağı, Osmanağa Mahallesi, Kadıköy, İstanbul, 34710, Türkiye",
  "address":{"office":"Final Kursu","house_number":"23","road":"Nail Bey Sokağı","suburb":"Osmanağa Mahallesi",
    "town":"Kadıköy","province":"İstanbul","region":"Marmara Bölgesi","postcode":"34710","country":"Türkiye","country_code":"tr"}}`

func TestReverseAsksNominatimAndComposesLine(t *testing.T) {
	service, fake := newTestService(t, func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, reverseBody) })

	result, err := service.Reverse(context.Background(), 40.9885, 29.027)

	if err != nil || result.Line != "Osmanağa Mahallesi, Nail Bey Sokağı 23, 34710 Kadıköy/İstanbul, Türkiye" {
		t.Fatalf("adres satiri bekleniyordu: %+v %v", result, err)
	}
	request := fake.last()
	if request.URL.Path != "/nominatim/reverse" || request.Header.Get("User-Agent") != testUserAgent {
		t.Errorf("kok adresin altindaki /reverse'e, tanitan User-Agent ile gitmeli: %s %q", request.URL.Path, request.Header.Get("User-Agent"))
	}
	query := request.URL.Query()
	want := map[string]string{"lat": "40.9885", "lon": "29.027", "zoom": "18", "format": "jsonv2", "addressdetails": "1", "accept-language": "tr"}
	for name, value := range want {
		if query.Get(name) != value {
			t.Errorf("%s=%q bekleniyordu, %q gitti", name, value, query.Get(name))
		}
	}
}

func TestReverseCachesNearbyPoints(t *testing.T) {
	service, fake := newTestService(t, func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, reverseBody) })

	for _, point := range [][2]float64{{40.98850, 29.02700}, {40.988501, 29.027001}} {
		if _, err := service.Reverse(context.Background(), point[0], point[1]); err != nil {
			t.Fatalf("cevap bekleniyordu: %v", err)
		}
	}

	if fake.count() != 1 {
		t.Errorf("~1 m icindeki ikinci soru onbellekten donmeli: %d istek", fake.count())
	}
}

func TestReverseWithoutAddressIsNotFoundAndCached(t *testing.T) {
	service, fake := newTestService(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"error":"Unable to geocode"}`)
	})

	for range 2 {
		if _, err := service.Reverse(context.Background(), 40.5, 28.9); codeOf(err) != apperror.CodeNotFound {
			t.Errorf("adres yoksa NOT_FOUND bekleniyordu: %v", err)
		}
	}
	if fake.count() != 1 {
		t.Errorf("adresi olmayan nokta da onbelleklenmeli: %d istek", fake.count())
	}
}

func TestUpstreamFailureIsUnavailableAndNotCached(t *testing.T) {
	cases := map[string]func(w http.ResponseWriter, r *http.Request){
		"5xx":         func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) },
		"429":         func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) },
		"bozuk cevap": func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, `{"lat":`) },
	}
	for name, respond := range cases {
		service, fake := newTestService(t, respond)

		_, reverseErr := service.Reverse(context.Background(), 41, 29)
		_, searchErr := service.Search(context.Background(), "Moda Caddesi")
		_, againErr := service.Reverse(context.Background(), 41, 29)

		for _, err := range []error{reverseErr, searchErr, againErr} {
			if codeOf(err) != apperror.CodeServiceUnavailable || errors.Unwrap(err) == nil {
				t.Errorf("%s: SERVICE_UNAVAILABLE ve gunluge giden sebep bekleniyordu: %v", name, err)
			}
		}
		if fake.count() != 3 {
			t.Errorf("%s: hata onbelleklenmemeli: %d istek", name, fake.count())
		}
	}
}

func TestReverseValidatesCoordinatesBeforeAsking(t *testing.T) {
	service, fake := newTestService(t, func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, reverseBody) })

	_, err := service.Reverse(context.Background(), 91, -181)

	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeValidationFailed ||
		appErr.Details[FieldLat] != latitudeReason || appErr.Details[FieldLng] != longitudeReason {
		t.Errorf("iki koordinat sorunu birden bekleniyordu: %v", err)
	}
	if fake.count() != 0 {
		t.Error("gecersiz noktada Nominatim'e gidilmemeli")
	}
}

func TestSearchReturnsUsablePlacesOnce(t *testing.T) {
	body := `[
	  {"lat":"40.9879337","lon":"29.0252216","address":{"road":"Moda Caddesi","quarter":"Bahariye","suburb":"Caferağa Mahallesi","town":"Kadıköy","province":"İstanbul","postcode":"34710","country":"Türkiye"}},
	  {"lat":"40.9879","lon":"29.0252","address":{"road":"Moda Caddesi","suburb":"Caferağa Mahallesi","town":"Kadıköy","province":"İstanbul","postcode":"34710","country":"Türkiye"}},
	  {"lat":"yok","lon":"29","address":{"road":"Bozuk","country":"Türkiye"}},
	  {"lat":"95","lon":"29","address":{"road":"Kutup","country":"Türkiye"}},
	  {"lat":"41.0","lon":"29.0","display_name":"","address":{}},
	  {"lat":"40.99","lon":"29.03","address":{"road":"Moda Caddesi","suburb":"Osmanağa Mahallesi","town":"Kadıköy","province":"İstanbul","country":"Türkiye"}}
	]`
	service, fake := newTestService(t, func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, body) })

	result, err := service.Search(context.Background(), "  Moda   Caddesi ")
	if err != nil {
		t.Fatalf("sonuc bekleniyordu: %v", err)
	}

	want := []Place{
		{Line: "Caferağa Mahallesi, Moda Caddesi, 34710 Kadıköy/İstanbul, Türkiye", Location: rest.GeoPoint{Lat: 40.9879337, Lng: 29.0252216}},
		{Line: "Osmanağa Mahallesi, Moda Caddesi, Kadıköy/İstanbul, Türkiye", Location: rest.GeoPoint{Lat: 40.99, Lng: 29.03}},
	}
	if len(result.Items) != len(want) || result.Items[0] != want[0] || result.Items[1] != want[1] {
		t.Errorf("ayni satir bir kez, konumsuz ve satirsiz sonuc yok:\n got %+v\nwant %+v", result.Items, want)
	}
	query := fake.last().URL.Query()
	if fake.last().URL.Path != "/nominatim/search" || query.Get("q") != "Moda Caddesi" || query.Get("countrycodes") != "tr" ||
		query.Get("limit") != "5" || query.Get("format") != "jsonv2" || query.Get("accept-language") != "tr" {
		t.Errorf("arama parametreleri yanlis: %s %v", fake.last().URL.Path, query)
	}
}

func TestSearchCapsResultsAndEmptyIsArray(t *testing.T) {
	var items []string
	for i := range 8 {
		items = append(items, `{"lat":"41.0`+string(rune('0'+i))+`","lon":"29","address":{"road":"Sokak `+string(rune('A'+i))+`","country":"Türkiye"}}`)
	}
	service, _ := newTestService(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("q") == "bos sonuc" {
			writeJSON(t, w, `[]`)
			return
		}
		writeJSON(t, w, "["+strings.Join(items, ",")+"]")
	})

	result, err := service.Search(context.Background(), "Sokak")
	if err != nil || len(result.Items) != SearchResultsMax {
		t.Errorf("en fazla %d sonuc bekleniyordu: %d %v", SearchResultsMax, len(result.Items), err)
	}
	empty, err := service.Search(context.Background(), "bos sonuc")
	if err != nil {
		t.Fatalf("bos sonuc hata olmamali: %v", err)
	}
	encoded, err := json.Marshal(empty)
	if err != nil || string(encoded) != `{"items":[]}` {
		t.Errorf("sonuc yoksa bos dizi (null degil): %s %v", encoded, err)
	}
}

func TestSearchCacheIgnoresCaseAndSpacing(t *testing.T) {
	service, fake := newTestService(t, func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, `[]`) })

	for _, query := range []string{"İSTİKLAL Caddesi", "istiklal  caddesi", " İstiklal Caddesi "} {
		if _, err := service.Search(context.Background(), query); err != nil {
			t.Fatalf("%q: %v", query, err)
		}
	}
	if fake.count() != 1 {
		t.Errorf("Turkce buyuk-kucuk harf ve bosluk farki ayni soru sayilmali: %d istek", fake.count())
	}
}

func TestSearchValidatesQueryLength(t *testing.T) {
	service, fake := newTestService(t, func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, `[]`) })

	cases := map[string]string{
		"   ab   ":                    queryMinReason,
		strings.Repeat("ş", 101):      queryMaxReason,
		"a  b":                        "",
		strings.Repeat("ğ", 100):      "",
		"  " + strings.Repeat("ç", 3): "",
	}
	for query, reason := range cases {
		_, err := service.Search(context.Background(), query)
		var appErr *apperror.Error
		switch {
		case reason == "" && err != nil:
			t.Errorf("%q gecmeli: %v", query, err)
		case reason != "" && (!errors.As(err, &appErr) || appErr.Details[FieldQuery] != reason):
			t.Errorf("%q: %q bekleniyordu: %v", query, reason, err)
		}
	}
	if fake.count() != 3 {
		t.Errorf("yalnizca gecerli aramalar sorulmali: %d istek", fake.count())
	}
}

func TestBusyQueueIsUnavailableWithoutAsking(t *testing.T) {
	fake := &fakeNominatim{respond: func(w http.ResponseWriter, _ *http.Request) { writeJSON(t, w, reverseBody) }}
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	base, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("adres cozulemedi: %v", err)
	}
	// Siradaki yer bir saat sonra, soru siniri bir saniye.
	service := New(Options{BaseURL: base, UserAgent: testUserAgent, Timeout: time.Second, Interval: time.Hour})
	if _, err := service.Reverse(context.Background(), 41, 29); err != nil {
		t.Fatalf("ilk soru beklemeden gitmeli: %v", err)
	}

	_, err = service.Reverse(context.Background(), 40, 28)

	if codeOf(err) != apperror.CodeServiceUnavailable || !errors.Is(err, errQueueFull) || fake.count() != 1 {
		t.Errorf("sira doluysa beklemeden SERVICE_UNAVAILABLE: %v (%d istek)", err, fake.count())
	}
}
