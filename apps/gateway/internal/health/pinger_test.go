package health

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// fakePinger, gRPC disi bagimliligi (Mongo) taklit eder.
type fakePinger struct {
	err   error
	delay time.Duration
}

func (f fakePinger) Ping(ctx context.Context) error {
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return f.err
}

func TestPingerJoinsReport(t *testing.T) {
	checker := New(map[string]Client{"catalog": serving()}, map[string]Pinger{"mongo": fakePinger{}}, testTimeout, false, discardLogger())

	report := checker.Check(context.Background())

	if report.Status != ReportOK || len(report.Services) != 2 {
		t.Fatalf("iki kalemli saglikli rapor bekleniyordu: %+v", report)
	}
	if got := report.Services[1]; got.Name != "mongo" || got.Status != StatusServing {
		t.Errorf("mongo SERVING olmali ve adla siralanmali: %+v", got)
	}
}

func TestFailingPingerDegradesWithoutLeakingDetails(t *testing.T) {
	// /healthz disariya acik: surucunun mesajindaki ic adres cevaba girmemeli.
	checker := New(nil, map[string]Pinger{
		"mongo": fakePinger{err: errors.New("dial tcp 10.0.0.5:27017: connection refused")},
	}, testTimeout, false, discardLogger())

	report := checker.Check(context.Background())

	if report.Status != ReportDegraded {
		t.Errorf("mongo dusukken rapor degraded olmali: %+v", report)
	}
	if got := report.Services[0]; got.Status != StatusUnreachable || got.Error != pingFailure {
		t.Errorf("UNREACHABLE ve yalnizca kod bekleniyordu: %+v", got)
	}
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("rapor kodlanamadi: %v", err)
	}
	if strings.Contains(string(encoded), "10.0.0.5") {
		t.Errorf("ic adres cevaba sizdi: %s", encoded)
	}
}

func TestPingerRespectsTimeout(t *testing.T) {
	checker := New(nil, map[string]Pinger{"mongo": fakePinger{delay: time.Second}}, testTimeout, false, discardLogger())

	startedAt := time.Now()
	report := checker.Check(context.Background())

	if elapsed := time.Since(startedAt); elapsed > 3*testTimeout {
		t.Errorf("son tarih uygulanmadi, %v surdu", elapsed)
	}
	if report.Services[0].Status != StatusUnreachable {
		t.Errorf("takilan mongo UNREACHABLE olmali: %+v", report.Services[0])
	}
}
