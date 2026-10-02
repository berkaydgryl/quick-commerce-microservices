package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/content"
)

// fakeWelcome, icerik kaynaginin yerine gecer.
type fakeWelcome struct {
	welcome content.Welcome
	err     error
	called  bool
}

func (f *fakeWelcome) Welcome(context.Context) (content.Welcome, error) {
	f.called = true
	return f.welcome, f.err
}

func appWithWelcome(source *fakeWelcome) Deps {
	return Deps{Health: fakeReporter{report: healthyReport()}, WelcomeContent: source, Logger: silentLogger()}
}

func sampleWelcome() content.Welcome {
	return content.Welcome{
		Header: content.Header{Brand: "getir", Service: "market", LoginLabel: "Giriş yap", RegisterLabel: "Kayıt ol"},
		Hero: content.Hero{
			Title: "Kapına gelen market",
			Banner: content.Banner{
				Sources: []content.BannerSource{{URL: "https://cdn.example.com/img/banner/a-960.jpg", Width: 960}},
				Width:   960,
				Height:  277,
			},
		},
		LoginCard: content.LoginCard{
			Title:     "Giriş yap veya kayıt ol",
			Countries: []content.PhoneCountry{{Code: "TR", Name: "Türkiye", DialCode: "+90", FlagURL: "https://cdn.example.com/img/flag/tr.svg"}},
		},
		Categories: content.CategoriesHeader{Title: "Kategoriler & Fırsatlar"},
	}
}

func TestWelcomeContentReturnsEnvelope(t *testing.T) {
	source := &fakeWelcome{welcome: sampleWelcome()}
	app := New(appWithWelcome(source))

	response, err := app.Test(newRequest(t, http.MethodGet, "/v1/content/welcome", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("200 bekleniyordu, %d geldi", response.StatusCode)
	}
	body, readErr := io.ReadAll(response.Body)
	closeBody(t, response)
	if readErr != nil {
		t.Fatalf("cevap govdesi okunamadi: %v", readErr)
	}
	// Alan adlari sozlesmeyle (welcomeContentSchema) ayni; & kacislanmaz.
	for _, want := range []string{
		`"success":true`,
		`"loginCard":{"title":"Giriş yap veya kayıt ol"`,
		`"dialCode":"+90"`,
		`"flagUrl":"https://cdn.example.com/img/flag/tr.svg"`,
		`"banner":{"sources":[{"url":"https://cdn.example.com/img/banner/a-960.jpg","width":960}],"width":960,"height":277}`,
		`"categories":{"title":"Kategoriler & Fırsatlar"}`,
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("cevapta %s yok: %s", want, body)
		}
	}
}

func TestWelcomeContentRejectsUnknownQuery(t *testing.T) {
	source := &fakeWelcome{welcome: sampleWelcome()}
	app := New(appWithWelcome(source))

	response, err := app.Test(newRequest(t, http.MethodGet, "/v1/content/welcome?lang=en", nil))
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
	if details, isMap := envelope.Error.Details.(map[string]any); !isMap || details["lang"] == nil {
		t.Errorf("details bilinmeyen parametreyi adiyla gostermeli: %+v", envelope.Error.Details)
	}
	if source.called {
		t.Error("gecersiz istekte kaynak okunmamaliydi")
	}
}

func TestWelcomeContentMapsSourceError(t *testing.T) {
	// Bugunku kaynak hata vermez; bir CMS kaynagi verebilir ve hata tablosundan gecer.
	source := &fakeWelcome{err: &apperror.Error{Code: apperror.CodeServiceUnavailable, Cause: errors.New("cms kapali")}}
	app := New(appWithWelcome(source))

	response, err := app.Test(newRequest(t, http.MethodGet, "/v1/content/welcome", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("503 bekleniyordu, %d geldi", response.StatusCode)
	}
	if envelope := decode(t, response); envelope.Error.Message != apperror.Message(apperror.CodeServiceUnavailable) {
		t.Errorf("ic mesaj sizdi: %q", envelope.Error.Message)
	}
}
