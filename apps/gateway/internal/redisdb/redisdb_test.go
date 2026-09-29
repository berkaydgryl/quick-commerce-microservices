package redisdb

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestBadURLDoesNotLeakPassword(t *testing.T) {
	// Cozulemeyen adresin hatasi gunluge gider; icindeki parola sizmamali.
	_, err := Connect(t.Context(), Options{URL: "redis://:cok-gizli-parola@localhost:6379/abc", ConnectTimeout: time.Second, OperationTimeout: time.Second})

	if !errors.Is(err, errBadURL) || strings.Contains(err.Error(), "cok-gizli-parola") {
		t.Errorf("parolasiz bicim hatasi bekleniyordu: %v", err)
	}
}

func TestUnreachableRedisFailsFast(t *testing.T) {
	// Redis kapaliyken gateway "ayakta" gorunmemeli: hata acilista, baglanti
	// suresi icinde gelir.
	startedAt := time.Now()

	_, err := Connect(t.Context(), Options{URL: "redis://127.0.0.1:1", ConnectTimeout: 300 * time.Millisecond, OperationTimeout: time.Second})

	if err == nil || !strings.Contains(err.Error(), "redis'e ulasilamadi") {
		t.Fatalf("ulasilamayan Redis acilis hatasi vermeli: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 3*time.Second {
		t.Errorf("baglanti suresi uygulanmali, %v surdu", elapsed)
	}
}

func TestDriverLinesBecomeJSONWarnings(t *testing.T) {
	var out bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&out, nil)).With(slog.String("service", "gateway"))

	driverLogger{logger: logger}.Printf(t.Context(), "redis: connection pool: failed to dial after %d attempts: %v", 5, errors.New("connection refused"))

	var line map[string]any
	if err := json.Unmarshal(out.Bytes(), &line); err != nil {
		t.Fatalf("satir JSON olmali: %v (%s)", err, out.String())
	}
	if line["level"] != "WARN" || line["service"] != "gateway" ||
		line["detail"] != "redis: connection pool: failed to dial after 5 attempts: connection refused" {
		t.Errorf("servis adli WARN satiri ve bicimlenmis ayrinti bekleniyordu: %v", line)
	}
}

func TestClientOptionsBoundEveryCommandOnce(t *testing.T) {
	parsed, err := clientOptions(Options{URL: "redis://localhost:6379/2", ConnectTimeout: time.Second, OperationTimeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("gecerli adres cozulmeli: %v", err)
	}
	if parsed.MaxRetries != -1 || parsed.ReadTimeout != 2*time.Second || parsed.WriteTimeout != 2*time.Second ||
		parsed.DialTimeout != time.Second || parsed.DB != 2 || parsed.Addr != "localhost:6379" {
		t.Errorf("komut tekrarsiz ve istek suresiyle sinirli olmali: %+v", parsed)
	}
}
