package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// fakeSearcher, genel aramayi taklit eder ve aldigi girdiyi saklar.
type fakeSearcher struct {
	calls int
	query catalog.SearchQuery
	err   error
}

func (f *fakeSearcher) Search(_ context.Context, query catalog.SearchQuery) (catalog.SearchResultList, error) {
	f.calls++
	f.query = query
	return catalog.SearchResultList{Items: []catalog.SearchResult{}}, f.err
}

// search, GET /v1/search istegini uygular; durum kodunu ve zarfi dondurur.
func search(t *testing.T, fake *fakeSearcher, target string) (int, Envelope) {
	t.Helper()
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, NearbySearch: fake, Logger: silentLogger()})
	response, err := app.Test(newRequest(t, http.MethodGet, target, nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	return response.StatusCode, decode(t, response)
}

func TestSearchParsesLocationAndQuery(t *testing.T) {
	fake := &fakeSearcher{}
	status, envelope := search(t, fake, "/v1/search?lat=40.9885&lng=29.0262&q=s%C3%BCt")

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 + success bekleniyordu: %d %+v", status, envelope)
	}
	if want := (catalog.SearchQuery{Lat: 40.9885, Lng: 29.0262, Query: "süt"}); fake.query != want {
		t.Errorf("girdi servise tasinmadi: %+v", fake.query)
	}
}

func TestSearchReportsAllMissingLocationFields(t *testing.T) {
	// Konum eksik: iki alan birden details'te, servis HIC cagrilmaz.
	fake := &fakeSearcher{}
	status, envelope := search(t, fake, "/v1/search?q=sut")

	expectValidation(t, status, envelope, "lat", requiredReason)
	expectValidation(t, status, envelope, "lng", requiredReason)
	if fake.calls != 0 {
		t.Errorf("gecersiz istekte servis cagrilmamali, %d cagri", fake.calls)
	}
}

func TestSearchRejectsNonNumbers(t *testing.T) {
	for _, target := range []string{
		"/v1/search?lat=kadikoy&lng=29&q=sut",
		"/v1/search?lat=NaN&lng=29&q=sut",
	} {
		status, envelope := search(t, &fakeSearcher{}, target)
		expectValidation(t, status, envelope, "lat", numberReason)
	}
}

func TestSearchRejectsUnknownQuery(t *testing.T) {
	// Proto adi (query) REST'te gecmez: sessizce yok sayilsaydi arama bos gider,
	// istemci "zorunlu" hatasinin sebebini anlamazdi.
	status, envelope := search(t, &fakeSearcher{}, "/v1/search?lat=40&lng=29&query=sut")
	expectValidation(t, status, envelope, "query", unknownQueryReason)
}

func TestSearchLeavesQueryRuleToCatalog(t *testing.T) {
	// q yok: gateway kurali TEKRAR yazmaz, bos aramayi servise gecirir;
	// servisin dogrulama hatasi (details.q) oldugu gibi doner.
	fake := &fakeSearcher{err: apperror.New(apperror.CodeValidationFailed, map[string]string{"q": "zorunlu"})}
	status, envelope := search(t, fake, "/v1/search?lat=40.9885&lng=29.0262")

	expectValidation(t, status, envelope, "q", "zorunlu")
	if fake.calls != 1 || fake.query.Query != "" {
		t.Errorf("bos arama servise gitmeli: %d cagri, %+v", fake.calls, fake.query)
	}
}

func TestSearchCountsTowardsTheGeneralIPLimit(t *testing.T) {
	// Arama kimliksizdir; diger katalog uclari gibi IP basina genel sinira tabi
	// (yazarken arama cok istek uretebilir, istemci 300 ms bekler; T9.5).
	app := limitedApp(t, memoryLimits(newTestClock(), 1, 10, 10), &fakeOrders{}, silentLogger())
	const target = "/v1/search?lat=40.9885&lng=29.0262&q=sut"

	if status, _, _ := getStatus(t, app, target, nil); status != http.StatusOK {
		t.Fatalf("ilk istek 200 donmeli: %d", status)
	}
	if status, _, _ := getStatus(t, app, target, nil); status != http.StatusTooManyRequests {
		t.Errorf("ikinci istek sinira takilmali (429): %d", status)
	}
}
