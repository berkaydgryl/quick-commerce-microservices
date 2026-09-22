package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// fakeLister, adaptorun yerine gecer; aldigi baglami da saklar ki korelasyon
// kimliginin servise gidip gitmedigi dogrulanabilsin.
type fakeLister struct {
	list   catalog.CategoryList
	err    error
	called bool
	ctx    context.Context
}

func (f *fakeLister) ListCategories(ctx context.Context) (catalog.CategoryList, error) {
	f.called = true
	f.ctx = ctx
	return f.list, f.err
}

func appWith(lister *fakeLister) Deps {
	return Deps{Health: fakeReporter{report: healthyReport()}, Categories: lister, Logger: silentLogger()}
}

func TestListCategoriesReturnsItems(t *testing.T) {
	lister := &fakeLister{list: catalog.CategoryList{Items: []catalog.Category{
		{ID: "cat_1", Name: "Süt & Kahvaltılık", Slug: "sut-kahvaltilik", SortOrder: 1},
	}}}
	app := New(appWith(lister))

	request := httptest.NewRequest(http.MethodGet, "/v1/categories", nil)
	request.Header.Set(RequestIDHeader, "req_kategori")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusOK {
		t.Fatalf("200 bekleniyordu, %d geldi", response.StatusCode)
	}
	if envelope := decode(t, response); !envelope.Success {
		t.Errorf("success true bekleniyordu: %+v", envelope)
	}

	// Korelasyon kimligi servise metadata olarak gitmeli; yoksa servis gunlugu
	// gateway gunluguyle eslesmez.
	outgoing, _ := metadata.FromOutgoingContext(lister.ctx)
	if got := outgoing.Get(requestIDMetadataKey); len(got) != 1 || got[0] != "req_kategori" {
		t.Errorf("x-request-id servise tasinmadi: %v", got)
	}
}

func TestListCategoriesRejectsUnknownQuery(t *testing.T) {
	// T3.4 olcutu: gecersiz query 400 doner. Servis HIC cagrilmamali.
	lister := &fakeLister{}
	app := New(appWith(lister))

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/v1/categories?categoryID=cat_1", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusBadRequest {
		t.Errorf("400 bekleniyordu, %d geldi", response.StatusCode)
	}
	envelope := decode(t, response)
	if envelope.Error == nil || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Fatalf("VALIDATION_FAILED bekleniyordu: %+v", envelope)
	}
	details, isMap := envelope.Error.Details.(map[string]any)
	if !isMap || details["categoryID"] == nil {
		t.Errorf("details bilinmeyen alani adiyla gostermeli: %+v", envelope.Error.Details)
	}
	if envelope.Error.Message != apperror.Message(apperror.CodeValidationFailed) {
		t.Errorf("mesaj sozlukten gelmeli, %q geldi", envelope.Error.Message)
	}
	if lister.called {
		t.Error("gecersiz istekte servis cagrilmamaliydi")
	}
}

func TestListCategoriesMapsServiceError(t *testing.T) {
	// Adaptor servis hatasini apperror'a indirir; HTTP kodu tablodan gelir.
	lister := &fakeLister{err: &apperror.Error{Code: apperror.CodeServiceUnavailable, Cause: errors.New("katalog kapali")}}
	app := New(appWith(lister))

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/v1/categories", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("503 bekleniyordu, %d geldi", response.StatusCode)
	}
	envelope := decode(t, response)
	if envelope.Error.Code != apperror.CodeServiceUnavailable {
		t.Errorf("SERVICE_UNAVAILABLE bekleniyordu: %+v", envelope.Error)
	}
	// Ic sebep ("katalog kapali") istemciye sizmamali.
	if envelope.Error.Message != apperror.Message(apperror.CodeServiceUnavailable) {
		t.Errorf("ic mesaj sizdi: %q", envelope.Error.Message)
	}
}

func TestUnexpectedErrorBecomesInternal(t *testing.T) {
	lister := &fakeLister{err: errors.New("beklenmeyen")}
	app := New(appWith(lister))

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/v1/categories", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusInternalServerError {
		t.Errorf("500 bekleniyordu, %d geldi", response.StatusCode)
	}
	if envelope := decode(t, response); envelope.Error.Code != apperror.CodeInternal {
		t.Errorf("INTERNAL bekleniyordu: %+v", envelope.Error)
	}
}

func TestJSONDoesNotEscapeHTML(t *testing.T) {
	lister := &fakeLister{list: catalog.CategoryList{Items: []catalog.Category{{ID: "cat_1", Name: "Süt & Kahvaltılık", Slug: "sut"}}}}
	app := New(appWith(lister))

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/v1/categories", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	defer func() { _ = response.Body.Close() }()

	body, _ := io.ReadAll(response.Body)
	if !strings.Contains(string(body), "Süt & Kahvaltılık") {
		t.Errorf("& kacislanmamali: %s", body)
	}
}
