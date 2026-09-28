package httpapi

import (
	"context"
	"net/http"
	"testing"

	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
)

func TestHealthzReturnsOKWhenAllServing(t *testing.T) {
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, Logger: silentLogger()})

	response, err := app.Test(newRequest(t, http.MethodGet, "/healthz", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusOK {
		t.Errorf("200 bekleniyordu, %d geldi", response.StatusCode)
	}

	envelope := decode(t, response)
	if !envelope.Success {
		t.Errorf("success true bekleniyordu: %+v", envelope)
	}
}

func TestHealthzReturns503WhenDegraded(t *testing.T) {
	// Probe govdeyi degil KODU okur; bagimli servis dustugunde gateway hazir
	// sayilmamali.
	app := New(Deps{Health: fakeReporter{report: degradedReport()}, Logger: silentLogger()})

	response, err := app.Test(newRequest(t, http.MethodGet, "/healthz", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}

	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("503 bekleniyordu, %d geldi", response.StatusCode)
	}

	envelope := decode(t, response)
	if envelope.Success || envelope.Error == nil {
		t.Fatalf("hata zarfi bekleniyordu: %+v", envelope)
	}
	if envelope.Error.Code != "SERVICE_UNAVAILABLE" {
		t.Errorf("kod: %q geldi", envelope.Error.Code)
	}
	if envelope.Error.RequestID == "" {
		t.Error("requestId dolu olmaliydi (gunlukle eslesmeli)")
	}
}

// recordingReporter, rapor doner ve aldigi baglami saklar: korelasyon
// kimliginin saglik sorgusuyla servislere gidip gitmedigi dogrulanabilsin.
type recordingReporter struct {
	report health.Report
	ctx    context.Context
}

func (r *recordingReporter) Check(ctx context.Context) health.Report {
	r.ctx = ctx
	return r.report
}

func TestHealthzForwardsRequestID(t *testing.T) {
	// D8: saglik sorgusu da x-request-id tasir; servisin saglik kaydi gateway
	// gunluguyle eslesir.
	reporter := &recordingReporter{report: healthyReport()}
	app := New(Deps{Health: reporter, Logger: silentLogger()})

	request := newRequest(t, http.MethodGet, "/healthz", nil)
	request.Header.Set(RequestIDHeader, testRequestID)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	outgoing, found := metadata.FromOutgoingContext(reporter.ctx)
	if !found {
		t.Fatal("saglik sorgusunun baglaminda metadata yok")
	}
	if got := outgoing.Get(requestIDMetadataKey); len(got) != 1 || got[0] != testRequestID {
		t.Errorf("x-request-id servislere tasinmali: %v", got)
	}
}
