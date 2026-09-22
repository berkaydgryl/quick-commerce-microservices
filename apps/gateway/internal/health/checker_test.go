package health

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health/grpc_health_v1"
)

// fakeClient, gercek gRPC baglantisi olmadan istemciyi taklit eder.
// Arayuz tek metotlu oldugu icin taklit de tek metot.
type fakeClient struct {
	status grpc_health_v1.HealthCheckResponse_ServingStatus
	err    error
	delay  time.Duration
}

func (f fakeClient) Check(ctx context.Context, _ *grpc_health_v1.HealthCheckRequest, _ ...grpc.CallOption) (*grpc_health_v1.HealthCheckResponse, error) {
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.err != nil {
		return nil, f.err
	}
	return &grpc_health_v1.HealthCheckResponse{Status: f.status}, nil
}

func serving() fakeClient {
	return fakeClient{status: grpc_health_v1.HealthCheckResponse_SERVING}
}

const testTimeout = 200 * time.Millisecond

func TestCheckAllServing(t *testing.T) {
	checker := New(map[string]Client{"catalog": serving(), "order": serving()}, testTimeout, false)

	report := checker.Check(context.Background())

	if !report.Healthy() {
		t.Fatalf("ok bekleniyordu: %+v", report)
	}
	// Harita sirasi rastgeledir; cevap her zaman alfabetik olmali.
	if report.Services[0].Name != "catalog" || report.Services[1].Name != "order" {
		t.Errorf("siralama bozuk: %+v", report.Services)
	}
}

func TestCheckDegradedWhenOneNotServing(t *testing.T) {
	checker := New(map[string]Client{
		"catalog": serving(),
		"order":   fakeClient{status: grpc_health_v1.HealthCheckResponse_NOT_SERVING},
	}, testTimeout, false)

	report := checker.Check(context.Background())

	if report.Healthy() {
		t.Fatal("degraded bekleniyordu")
	}
	if report.Services[1].Status != StatusNotServing {
		t.Errorf("NOT_SERVING bekleniyordu: %+v", report.Services[1])
	}
}

func TestCheckMarksUnreachableSeparately(t *testing.T) {
	// "Cevap vermedi" ile "kendini hasta bildirdi" ayni sey degildir.
	checker := New(map[string]Client{"catalog": fakeClient{err: errors.New("connection refused")}}, testTimeout, false)

	report := checker.Check(context.Background())

	if report.Services[0].Status != StatusUnreachable {
		t.Errorf("UNREACHABLE bekleniyordu: %+v", report.Services[0])
	}
	if report.Services[0].Error == "" {
		t.Error("kisa sebep dolu olmaliydi")
	}
}

func TestCheckAppliesTimeoutPerService(t *testing.T) {
	// Takilan servis, digerlerinin cevabini geciktirmemeli ve toplam sure tek
	// zaman asimini asmamali (paralel sorgu + cagri basina son tarih).
	checker := New(map[string]Client{
		"catalog": serving(),
		"order":   fakeClient{delay: time.Second, status: grpc_health_v1.HealthCheckResponse_SERVING},
	}, testTimeout, false)

	startedAt := time.Now()
	report := checker.Check(context.Background())
	elapsed := time.Since(startedAt)

	if elapsed > 500*time.Millisecond {
		t.Errorf("zaman asimi uygulanmadi, %v surdu", elapsed)
	}
	if report.Healthy() {
		t.Error("takilan servis degraded yapmaliydi")
	}
}

func TestReportCarriesMockFlag(t *testing.T) {
	// B16: /healthz modu bildirir.
	report := New(map[string]Client{"catalog": serving()}, testTimeout, true).Check(context.Background())

	if !report.Mock {
		t.Error("mock bayragi rapora gecmeliydi")
	}
}
