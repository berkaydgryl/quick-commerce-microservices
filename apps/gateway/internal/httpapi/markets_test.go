package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// fakeCatalog, dort pazaryeri arayuzunu birden karsilar ve aldigi girdiyi saklar.
type fakeCatalog struct {
	calls    int
	lat, lng float64
	marketID string
	query    catalog.ProductQuery
	err      error
}

func (f *fakeCatalog) NearbyMarkets(_ context.Context, lat, lng float64) (catalog.NearbyMarketList, error) {
	f.calls++
	f.lat, f.lng = lat, lng
	return catalog.NearbyMarketList{Items: []catalog.NearbyMarket{}}, f.err
}

func (f *fakeCatalog) Market(_ context.Context, marketID string) (catalog.Market, error) {
	f.calls++
	f.marketID = marketID
	return catalog.Market{ID: marketID}, f.err
}

func (f *fakeCatalog) MarketCategories(_ context.Context, marketID string) (catalog.CategoryList, error) {
	f.calls++
	f.marketID = marketID
	return catalog.CategoryList{Items: []catalog.Category{}}, f.err
}

func (f *fakeCatalog) MarketProducts(_ context.Context, query catalog.ProductQuery) (catalog.ProductPage, error) {
	f.calls++
	f.query = query
	return catalog.ProductPage{Items: []catalog.Product{}}, f.err
}

func marketApp(fake *fakeCatalog) Deps {
	return Deps{
		Health:           fakeReporter{report: healthyReport()},
		NearbyMarkets:    fake,
		Market:           fake,
		MarketCategories: fake,
		MarketProducts:   fake,
		Logger:           silentLogger(),
	}
}

func get(t *testing.T, fake *fakeCatalog, target string) (*http.Response, Envelope) {
	t.Helper()
	response, err := New(marketApp(fake)).Test(httptest.NewRequest(http.MethodGet, target, nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	return response, decode(t, response)
}

func expectValidation(t *testing.T, response *http.Response, envelope Envelope, field, reason string) {
	t.Helper()
	if response.StatusCode != http.StatusBadRequest {
		t.Errorf("400 bekleniyordu, %d geldi", response.StatusCode)
	}
	if envelope.Error == nil || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Fatalf("VALIDATION_FAILED bekleniyordu: %+v", envelope)
	}
	// JSON'dan cozulen details map[string]any olur.
	details, isMap := envelope.Error.Details.(map[string]any)
	if !isMap {
		t.Fatalf("details nesne olmali: %+v", envelope.Error.Details)
	}
	if got := details[field]; got != reason {
		t.Errorf("details[%s] = %q, %q bekleniyordu (tum details: %v)", field, got, reason, envelope.Error.Details)
	}
}

func TestNearbyMarketsParsesLocation(t *testing.T) {
	fake := &fakeCatalog{}
	response, envelope := get(t, fake, "/v1/markets?lat=40.9885&lng=29.0262")

	if response.StatusCode != http.StatusOK || !envelope.Success {
		t.Fatalf("200 + success bekleniyordu: %d %+v", response.StatusCode, envelope)
	}
	if fake.lat != 40.9885 || fake.lng != 29.0262 {
		t.Errorf("konum servise tasinmadi: %v %v", fake.lat, fake.lng)
	}
}

func TestNearbyMarketsReportsAllMissingFields(t *testing.T) {
	// Iki alan birden eksik: ikisi de details'te, servis HIC cagrilmaz.
	fake := &fakeCatalog{}
	response, envelope := get(t, fake, "/v1/markets")

	expectValidation(t, response, envelope, "lat", requiredReason)
	expectValidation(t, response, envelope, "lng", requiredReason)
	if fake.calls != 0 {
		t.Errorf("gecersiz istekte servis cagrilmamali, %d cagri", fake.calls)
	}
}

func TestNearbyMarketsRejectsNonNumbers(t *testing.T) {
	for _, target := range []string{
		"/v1/markets?lat=kadikoy&lng=29",
		"/v1/markets?lat=NaN&lng=29",
		"/v1/markets?lat=Inf&lng=29",
	} {
		response, envelope := get(t, &fakeCatalog{}, target)
		expectValidation(t, response, envelope, "lat", numberReason)
	}
}

func TestNearbyMarketsRejectsUnknownQuery(t *testing.T) {
	// Yazim hatali parametre (latitude) sessizce yok sayilmaz.
	response, envelope := get(t, &fakeCatalog{}, "/v1/markets?lat=40&lng=29&latitude=41")
	expectValidation(t, response, envelope, "latitude", unknownQueryReason)
}

func TestGetMarketForwardsPathParam(t *testing.T) {
	fake := &fakeCatalog{}
	response, _ := get(t, fake, "/v1/markets/mkt_migros-jet-moda")

	if response.StatusCode != http.StatusOK || fake.marketID != "mkt_migros-jet-moda" {
		t.Errorf("200 ve market kimligi bekleniyordu: %d %q", response.StatusCode, fake.marketID)
	}
}

func TestGetMarketPassesServiceError(t *testing.T) {
	// Olmayan market: kural serviste, gateway yalnizca hatayi zarflar.
	fake := &fakeCatalog{err: apperror.New(apperror.CodeNotFound, map[string]string{"marketId": "mkt_yok"})}
	response, envelope := get(t, fake, "/v1/markets/mkt_yok")

	if response.StatusCode != http.StatusNotFound || envelope.Error == nil || envelope.Error.Code != apperror.CodeNotFound {
		t.Errorf("404 NOT_FOUND bekleniyordu: %d %+v", response.StatusCode, envelope)
	}
}

func TestMarketCategoriesForwardsPathParam(t *testing.T) {
	fake := &fakeCatalog{}
	response, _ := get(t, fake, "/v1/markets/mkt_kardesler-manavi/categories")

	if response.StatusCode != http.StatusOK || fake.marketID != "mkt_kardesler-manavi" {
		t.Errorf("200 ve market kimligi bekleniyordu: %d %q", response.StatusCode, fake.marketID)
	}
}

func TestMarketProductsForwardsFilters(t *testing.T) {
	fake := &fakeCatalog{}
	response, _ := get(t, fake,
		"/v1/markets/mkt_migros-jet-moda/products?categoryId=cat_sut-kahvaltilik&q=s%C3%BCt&pageSize=20&pageToken=t1")

	want := catalog.ProductQuery{
		MarketID: "mkt_migros-jet-moda", CategoryID: "cat_sut-kahvaltilik", Query: "süt", PageSize: 20, PageToken: "t1",
	}
	if response.StatusCode != http.StatusOK || fake.query != want {
		t.Errorf("200 ve filtreler bekleniyordu: %d %+v", response.StatusCode, fake.query)
	}
}

func TestMarketProductsWithoutFiltersUsesServiceDefaults(t *testing.T) {
	fake := &fakeCatalog{}
	get(t, fake, "/v1/markets/mkt_migros-jet-moda/products")

	if fake.query != (catalog.ProductQuery{MarketID: "mkt_migros-jet-moda"}) {
		t.Errorf("filtresiz istekte bos degerler bekleniyordu: %+v", fake.query)
	}
}

func TestMarketProductsRejectsNonIntegerPageSize(t *testing.T) {
	fake := &fakeCatalog{}
	response, envelope := get(t, fake, "/v1/markets/mkt_migros-jet-moda/products?pageSize=on")

	expectValidation(t, response, envelope, "pageSize", integerReason)
	if fake.calls != 0 {
		t.Errorf("gecersiz istekte servis cagrilmamali")
	}
}

func TestMarketProductsRejectsUnknownQuery(t *testing.T) {
	response, envelope := get(t, &fakeCatalog{}, "/v1/markets/mkt_x/products?category=cat_x")
	expectValidation(t, response, envelope, "category", unknownQueryReason)
}
