package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
)

// fakeReporter, gercek gRPC baglantisi olmadan rapor doner.
type fakeReporter struct {
	report health.Report
}

func (f fakeReporter) Check(context.Context) health.Report { return f.report }

// silentLogger, test ciktisini kirletmeyen gunlukcu.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func healthyReport() health.Report {
	return health.Report{
		Status: health.ReportOK,
		Services: []health.ServiceStatus{
			{Name: "catalog", Status: health.StatusServing, LatencyMs: 2},
			{Name: "order", Status: health.StatusServing, LatencyMs: 3},
		},
	}
}

func degradedReport() health.Report {
	return health.Report{
		Status: health.ReportDegraded,
		Services: []health.ServiceStatus{
			{Name: "catalog", Status: health.StatusServing, LatencyMs: 2},
			{Name: "order", Status: health.StatusUnreachable, Error: "Unavailable"},
		},
	}
}

// testRequestID, bicime uyan sabit korelasyon kimligi (req_ + 32 onaltilik).
// Bicime uymayan kimlik gateway'de yenisiyle degistirilir (requestid.go).
const testRequestID = "req_0123456789abcdef0123456789abcdef"

// newRequest, test istegini testin baglamiyla kurar: test biterse istek de
// iptal olur (ag cagrisinin ilk parametresi context kurali testte de gecerli).
func newRequest(t *testing.T, method, target string, body io.Reader) *http.Request {
	t.Helper()
	return httptest.NewRequestWithContext(t.Context(), method, target, body)
}

// decode, cevap govdesini zarf olarak okur ve govdeyi kapatir.
//
// Kapatma BURADA, dogrudan yazilir: bodyclose denetleyicisi cevabin verildigi
// fonksiyonun yalnizca kendi govdesine bakar; kapatma baska bir yardimciya
// (closeBody) ya da ic ice fonksiyona konsaydi her cagiran bulgu olurdu.
func decode(t *testing.T, response *http.Response) Envelope {
	t.Helper()
	var envelope Envelope
	decodeErr := json.NewDecoder(response.Body).Decode(&envelope)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("cevap govdesi kapatilamadi: %v", closeErr)
	}
	if decodeErr != nil {
		t.Fatalf("cevap cozulemedi: %v", decodeErr)
	}
	return envelope
}

// closeBody, zarfi okunmayan cevabin govdesini kapatir; hata testi dusurur.
func closeBody(t *testing.T, response *http.Response) {
	t.Helper()
	if err := response.Body.Close(); err != nil {
		t.Errorf("cevap govdesi kapatilamadi: %v", err)
	}
}
