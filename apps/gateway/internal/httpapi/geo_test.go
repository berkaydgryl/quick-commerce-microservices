package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/geo"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// fakeGeo, harita adres servisinin yerine gecer; gelen girdiyi kaydeder.
type fakeGeo struct {
	called   bool
	lat, lng float64
	query    string
	err      error
}

func (f *fakeGeo) Reverse(_ context.Context, lat, lng float64) (geo.ReverseResult, error) {
	f.called, f.lat, f.lng = true, lat, lng
	if f.err != nil {
		return geo.ReverseResult{}, f.err
	}
	return geo.ReverseResult{Line: "Osmanağa Mahallesi, Nail Bey Sokağı 23, 34710 Kadıköy/İstanbul, Türkiye"}, nil
}

func (f *fakeGeo) Search(_ context.Context, query string) (geo.SearchResult, error) {
	f.called, f.query = true, query
	if f.err != nil {
		return geo.SearchResult{}, f.err
	}
	return geo.SearchResult{Items: []geo.Place{{Line: "Caferağa Mahallesi, Moda Caddesi", Location: rest.GeoPoint{Lat: 40.98, Lng: 29.02}}}}, nil
}

func geoApp(places *fakeGeo) *fiber.App {
	return New(Deps{
		Health:       fakeReporter{report: healthyReport()},
		GeoReverser:  places,
		GeoSearcher:  places,
		AccessTokens: testTokens(),
		Idempotency:  testIdempotency(),
		Logger:       silentLogger(),
	})
}

func geoRequest(t *testing.T, target string) *http.Request {
	t.Helper()
	request := newRequest(t, http.MethodGet, target, nil)
	request.Header.Set(fiber.HeaderAuthorization, bearer(t))
	return request
}

func TestReverseGeocodePassesPointAndIsNotCached(t *testing.T) {
	places := &fakeGeo{}

	status, header, envelope := exchange(t, geoApp(places), geoRequest(t, "/v1/geo/reverse?lat=40.9885&lng=29.027"))

	if status != http.StatusOK || places.lat != 40.9885 || places.lng != 29.027 {
		t.Fatalf("200 ve servise nokta bekleniyordu: %d %v,%v %+v", status, places.lat, places.lng, envelope)
	}
	if header.Get(fiber.HeaderCacheControl) != noStore {
		t.Errorf("konum kisisel veridir, onbelleklenmemeli: %q", header.Get(fiber.HeaderCacheControl))
	}
	data, err := json.Marshal(envelope.Data)
	if err != nil || string(data) != `{"line":"Osmanağa Mahallesi, Nail Bey Sokağı 23, 34710 Kadıköy/İstanbul, Türkiye"}` {
		t.Errorf("cevap reverseGeocodeResultSchema bicimi olmali: %s %v", data, err)
	}
}

func TestReverseGeocodeValidatesFormatBeforeAsking(t *testing.T) {
	cases := map[string]map[string]string{
		"/v1/geo/reverse?lng=29":             {"lat": requiredReason},
		"/v1/geo/reverse?lat=kuzey&lng=NaN":  {"lat": numberReason, "lng": numberReason},
		"/v1/geo/reverse?lat=41&lng=29&z=18": {"z": unknownQueryReason},
	}
	for target, want := range cases {
		places := &fakeGeo{}

		status, envelope := send(t, geoApp(places), geoRequest(t, target))

		details := detailsOf(t, envelope)
		for field, reason := range want {
			if details[field] != reason {
				t.Errorf("%s: %s=%q bekleniyordu: %+v", target, field, reason, details)
			}
		}
		if status != http.StatusBadRequest || places.called {
			t.Errorf("%s: 400 ve servis cagrilmamali: %d", target, status)
		}
	}
}

func TestReverseGeocodePassesServiceErrors(t *testing.T) {
	places := &fakeGeo{err: apperror.New(apperror.CodeNotFound, nil)}

	status, envelope := send(t, geoApp(places), geoRequest(t, "/v1/geo/reverse?lat=40.5&lng=28.9"))

	if status != http.StatusNotFound || envelope.Error == nil || envelope.Error.Code != apperror.CodeNotFound {
		t.Errorf("adres yoksa 404 NOT_FOUND bekleniyordu: %d %+v", status, envelope)
	}
}

func TestSearchPlacesPassesQueryAsIs(t *testing.T) {
	places := &fakeGeo{}

	status, header, envelope := exchange(t, geoApp(places), geoRequest(t, "/v1/geo/search?q=%20Moda%20Caddesi"))

	if status != http.StatusOK || places.query != " Moda Caddesi" || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("200, no-store ve kurallari uygulayan servise ham metin bekleniyordu: %d %q %+v", status, places.query, envelope)
	}
	data, err := json.Marshal(envelope.Data)
	if err != nil || string(data) != `{"items":[{"line":"Caferağa Mahallesi, Moda Caddesi","location":{"lat":40.98,"lng":29.02}}]}` {
		t.Errorf("cevap geoSearchResultSchema bicimi olmali: %s %v", data, err)
	}

	places = &fakeGeo{}
	status, envelope = send(t, geoApp(places), geoRequest(t, "/v1/geo/search?q=Moda&limit=50"))
	if status != http.StatusBadRequest || detailsOf(t, envelope)["limit"] != unknownQueryReason || places.called {
		t.Errorf("bilinmeyen parametre 400 donmeli, servis cagrilmamali: %d %+v", status, envelope)
	}
}
