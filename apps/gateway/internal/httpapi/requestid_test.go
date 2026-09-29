package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// requestIDOfResponse, bilinmeyen yola istek atar ve cevap basligindaki ile hata
// zarfindaki kimligi dondurur. Bilinmeyen yol, zarfi (requestId dahil) servis
// gerektirmeden ureten en kisa yoldur.
func requestIDOfResponse(t *testing.T, incoming string) (header, envelopeID string) {
	t.Helper()
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, Logger: silentLogger()})
	request := newRequest(t, http.MethodGet, "/yok", nil)
	if incoming != "" {
		request.Header.Set(RequestIDHeader, incoming)
	}
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	header = response.Header.Get(RequestIDHeader)
	envelope := decode(t, response)
	if envelope.Error == nil {
		t.Fatalf("hata zarfi bekleniyordu: %+v", envelope)
	}
	return header, envelope.Error.RequestID
}

func TestRequestIDIsGeneratedInContractFormat(t *testing.T) {
	// Node servisleri ile ayni bicim (@getir/core id.ts): gunlukte tek desen.
	header, envelopeID := requestIDOfResponse(t, "")

	if !validRequestID(header) {
		t.Errorf("uretilen kimlik req_ + 32 onaltilik olmali, %q geldi", header)
	}
	if envelopeID != header {
		t.Errorf("zarftaki requestId basliktakiyle ayni olmali: %q != %q", envelopeID, header)
	}
}

func TestValidIncomingRequestIDIsKept(t *testing.T) {
	// Bicime uyan kimlik korunur: istemci istegini gunlukte kendi kimligiyle bulur.
	header, envelopeID := requestIDOfResponse(t, testRequestID)

	if header != testRequestID || envelopeID != testRequestID {
		t.Errorf("gelen kimlik korunmaliydi: baslik %q, zarf %q", header, envelopeID)
	}
}

func TestForeignRequestIDIsReplaced(t *testing.T) {
	// Istemcinin serbest metni her servisin gunlugune yazilmaz (D8).
	cases := map[string]string{
		"eski test bicimi":      "req_disaridan",
		"buyuk harf":            strings.ToUpper(testRequestID),
		"bosluklu metin":        "benim istegim",
		"kisa govde":            testRequestID[:len(testRequestID)-1],
		"uzun govde":            testRequestID + "0",
		"onek yok":              strings.TrimPrefix(testRequestID, ids.Request+"_"),
		"cok uzun serbest dizi": strings.Repeat("a", 2048),
	}
	for name, incoming := range cases {
		header, envelopeID := requestIDOfResponse(t, incoming)

		if header == incoming || !validRequestID(header) {
			t.Errorf("%s: yeni kimlik uretilmeliydi, %q geldi", name, header)
		}
		if envelopeID != header {
			t.Errorf("%s: zarftaki requestId basliktakiyle ayni olmali: %q != %q", name, envelopeID, header)
		}
	}
}

func TestGeneratedRequestIDsDiffer(t *testing.T) {
	const samples = 100
	seen := make(map[string]struct{}, samples)
	for range samples {
		id := ids.New(ids.Request)
		if !validRequestID(id) {
			t.Fatalf("bicim disi kimlik: %q", id)
		}
		if _, repeated := seen[id]; repeated {
			t.Fatalf("ayni kimlik iki kez uretildi: %q", id)
		}
		seen[id] = struct{}{}
	}
}

// validRequestID, korelasyon kimliginin bicim denetimi (ids paketi).
func validRequestID(id string) bool {
	return ids.Valid(ids.Request, id)
}
