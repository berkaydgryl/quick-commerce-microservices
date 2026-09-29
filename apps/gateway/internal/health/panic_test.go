package health

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// Sorgusu panikleyen bagimlilik (T8.3). Sorgu ayri goroutine'de calisir;
// oradaki panik HTTP ara katmaninin kurtarmasina ulasmaz ve butun gateway'i
// dusururdu. Denetleyici onu kendisi yakalar: o bagimlilik ulasilamaz sayilir,
// digerleri etkilenmez, panik istegin kimligiyle gunluge yazilir.

// testRequestID, bicime uyan korelasyon kimligi (req_ + 32 onaltilik).
const testRequestID = "req_0123456789abcdef0123456789abcdef"

type panickingClient struct{}

func (panickingClient) Check(context.Context, *grpc_health_v1.HealthCheckRequest, ...grpc.CallOption) (*grpc_health_v1.HealthCheckResponse, error) {
	panic("istemci bozuldu: 10.0.0.5:50051")
}

type panickingPinger struct{}

func (panickingPinger) Ping(context.Context) error {
	var counters map[string]int
	counters["ping"]++ // nil haritaya yazim: calisma zamani panigi
	return nil
}

// panicRecord, gunlukteki panik satirinin sinanan alanlari.
type panicRecord struct {
	Level     string `json:"level"`
	Msg       string `json:"msg"`
	Service   string `json:"service"`
	RequestID string `json:"requestId"`
	Panic     string `json:"panic"`
	Stack     string `json:"stack"`
}

func panicRecords(t *testing.T, logs *bytes.Buffer) map[string]panicRecord {
	t.Helper()
	records := map[string]panicRecord{}
	for _, line := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		if line == "" {
			continue
		}
		var record panicRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("gunluk satiri JSON degil: %q", line)
		}
		if record.Msg == "saglik sorgusunda panik" {
			records[record.Service] = record
		}
	}
	return records
}

func TestPanickingProbeIsReportedUnreachable(t *testing.T) {
	var logs bytes.Buffer
	checker := New(
		map[string]Client{"catalog": serving(), "order": panickingClient{}},
		map[string]Pinger{"mongo": panickingPinger{}},
		testTimeout, false, slog.New(slog.NewJSONHandler(&logs, nil)),
	)
	ctx := metadata.AppendToOutgoingContext(t.Context(), rpc.RequestIDKey, testRequestID)

	report := checker.Check(ctx)

	if report.Status != ReportDegraded {
		t.Errorf("panikleyen bagimlilikla rapor degraded olmali: %+v", report)
	}
	want := map[string]ServiceStatus{
		"catalog": {Name: "catalog", Status: StatusServing},
		"mongo":   {Name: "mongo", Status: StatusUnreachable, Error: "Internal"},
		"order":   {Name: "order", Status: StatusUnreachable, Error: "Internal"},
	}
	for _, got := range report.Services {
		got.LatencyMs = 0
		if got != want[got.Name] {
			t.Errorf("%s: %+v bekleniyordu, %+v geldi", got.Name, want[got.Name], got)
		}
	}
	if len(report.Services) != len(want) {
		t.Errorf("uc kalem bekleniyordu: %+v", report.Services)
	}

	records := panicRecords(t, &logs)
	for service, frame := range map[string]string{"order": "panickingClient.Check", "mongo": "panickingPinger.Ping"} {
		record, found := records[service]
		if !found {
			t.Errorf("%s: panik satiri yok; gunluk: %s", service, logs.String())
			continue
		}
		if record.Level != "ERROR" || record.RequestID != testRequestID || record.Panic == "" {
			t.Errorf("%s: ERROR, istegin kimligi ve panik degeri bekleniyordu: %+v", service, record)
		}
		if !strings.Contains(record.Stack, frame) {
			t.Errorf("%s: yigin izi panigin cikis noktasini (%s) gostermeli:\n%s", service, frame, record.Stack)
		}
	}
}

func TestPanicDetailStaysOutOfTheReport(t *testing.T) {
	// /healthz disariya acik: panik degeri (burada ic adres) cevaba girmez.
	checker := New(map[string]Client{"order": panickingClient{}}, nil, testTimeout, false, discardLogger())

	report := checker.Check(t.Context())

	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("rapor kodlanamadi: %v", err)
	}
	if strings.Contains(string(encoded), "10.0.0.5") || strings.Contains(string(encoded), "bozuldu") {
		t.Errorf("panik ayrintisi rapora girmemeli: %s", encoded)
	}
}
