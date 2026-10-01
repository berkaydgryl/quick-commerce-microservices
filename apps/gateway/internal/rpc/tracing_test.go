package rpc_test

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	grpccodes "google.golang.org/grpc/codes"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// recordingCatalog, gelen metadata'yi kaydeden ve istenen hatayi donen sahte katalog.
type recordingCatalog struct {
	catalogv1.UnimplementedCatalogServiceServer
	incoming metadata.MD
	fail     error
}

func (s *recordingCatalog) ListCategories(ctx context.Context, _ *catalogv1.ListCategoriesRequest) (*catalogv1.ListCategoriesResponse, error) {
	s.incoming, _ = metadata.FromIncomingContext(ctx)
	if s.fail != nil {
		return nil, s.fail
	}
	return &catalogv1.ListCategoriesResponse{}, nil
}

// recordingHealth, gelen metadata'yi kaydeden saglik servisi.
type recordingHealth struct {
	grpc_health_v1.UnimplementedHealthServer
	incoming metadata.MD
}

func (h *recordingHealth) Check(ctx context.Context, _ *grpc_health_v1.HealthCheckRequest) (*grpc_health_v1.HealthCheckResponse, error) {
	h.incoming, _ = metadata.FromIncomingContext(ctx)
	return &grpc_health_v1.HealthCheckResponse{Status: grpc_health_v1.HealthCheckResponse_SERVING}, nil
}

// tracedConn, izleme ara katmanli bellek ici baglanti kurar.
func tracedConn(t *testing.T, register func(*grpc.Server)) (*grpc.ClientConn, *tracetest.SpanRecorder, trace.Tracer) {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	tracer := provider.Tracer("test")
	conn := testkit.BufconnClient(t, register, grpc.WithChainUnaryInterceptor(rpc.TracingInterceptor(tracer, propagation.TraceContext{})))
	return conn, recorder, tracer
}

func tracedCatalog(t *testing.T, server *recordingCatalog) (catalogv1.CatalogServiceClient, *tracetest.SpanRecorder, trace.Tracer) {
	t.Helper()
	conn, recorder, tracer := tracedConn(t, func(s *grpc.Server) {
		catalogv1.RegisterCatalogServiceServer(s, server)
	})
	return catalogv1.NewCatalogServiceClient(conn), recorder, tracer
}

func clientSpans(recorder *tracetest.SpanRecorder) []sdktrace.ReadOnlySpan {
	var found []sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		if span.SpanKind() == trace.SpanKindClient {
			found = append(found, span)
		}
	}
	return found
}

func onlyClientSpan(t *testing.T, recorder *tracetest.SpanRecorder) sdktrace.ReadOnlySpan {
	t.Helper()
	found := clientSpans(recorder)
	if len(found) != 1 {
		t.Fatalf("tek istemci span'i bekleniyordu, %d var", len(found))
	}
	return found[0]
}

func attribute(span sdktrace.ReadOnlySpan, key string) any {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsInterface()
		}
	}
	return nil
}

func TestTracingInterceptorChildSpanAndTraceparent(t *testing.T) {
	server := &recordingCatalog{}
	client, recorder, tracer := tracedCatalog(t, server)
	ctx, parent := tracer.Start(t.Context(), "http-istegi")
	ctx = metadata.AppendToOutgoingContext(ctx, rpc.RequestIDKey, "req_iz")

	if _, err := client.ListCategories(ctx, &catalogv1.ListCategoriesRequest{}); err != nil {
		t.Fatalf("cagri basarisiz: %v", err)
	}
	parent.End()

	span := onlyClientSpan(t, recorder)
	if span.Name() != "getir.catalog.v1.CatalogService/ListCategories" {
		t.Errorf("span adi tam metot olmali: %q", span.Name())
	}
	if span.Parent().SpanID() != parent.SpanContext().SpanID() || span.SpanContext().TraceID() != parent.SpanContext().TraceID() {
		t.Error("istemci span'i istegin span'inin cocugu olmali")
	}
	if attribute(span, "rpc.system") != "grpc" || attribute(span, "rpc.service") != "getir.catalog.v1.CatalogService" || attribute(span, "rpc.method") != "ListCategories" {
		t.Errorf("rpc nitelikleri eksik: %v", span.Attributes())
	}
	if span.Status().Code != codes.Unset {
		t.Errorf("basarili cagri hatali isaretlenmemeli: %v", span.Status())
	}
	// Karsi servis traceparent'i istemci span'inin kimligiyle gormeli; mevcut
	// metadata (x-request-id) korunmali.
	want := "00-" + span.SpanContext().TraceID().String() + "-" + span.SpanContext().SpanID().String() + "-01"
	if got := server.incoming.Get("traceparent"); len(got) != 1 || got[0] != want {
		t.Errorf("traceparent %v bekleniyordu: %v", want, got)
	}
	if got := server.incoming.Get(rpc.RequestIDKey); len(got) != 1 || got[0] != "req_iz" {
		t.Errorf("x-request-id korunmali: %v", got)
	}
}

func TestTracingInterceptorMarksOnlySystemFailures(t *testing.T) {
	cases := []struct {
		name   string
		code   grpccodes.Code
		status codes.Code
	}{
		{"is sonucu (FailedPrecondition)", grpccodes.FailedPrecondition, codes.Unset},
		{"bulunamadi (NotFound)", grpccodes.NotFound, codes.Unset},
		{"bagimli servis yok (Unavailable)", grpccodes.Unavailable, codes.Error},
		{"beklenmeyen (Internal)", grpccodes.Internal, codes.Error},
		{"sure doldu (DeadlineExceeded)", grpccodes.DeadlineExceeded, codes.Error},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := &recordingCatalog{fail: status.Error(tc.code, "deneme")}
			client, recorder, _ := tracedCatalog(t, server)

			if _, err := client.ListCategories(t.Context(), &catalogv1.ListCategoriesRequest{}); status.Code(err) != tc.code {
				t.Fatalf("%v bekleniyordu: %v", tc.code, err)
			}

			span := onlyClientSpan(t, recorder)
			if span.Status().Code != tc.status {
				t.Errorf("span durumu %v bekleniyordu: %v", tc.status, span.Status())
			}
			if attribute(span, "rpc.grpc.status_code") != int64(tc.code) {
				t.Errorf("durum kodu niteligi %d bekleniyordu: %v", tc.code, attribute(span, "rpc.grpc.status_code"))
			}
		})
	}
}

func TestTracingInterceptorSkipsHealthChecks(t *testing.T) {
	// /healthz her yoklamada her servisi cagirir: istek span'i icinden bile
	// gelse saglik cagrisi span acmaz ve traceparent tasimaz (ADR-20).
	server := &recordingHealth{}
	conn, recorder, tracer := tracedConn(t, func(s *grpc.Server) {
		grpc_health_v1.RegisterHealthServer(s, server)
	})
	ctx, parent := tracer.Start(t.Context(), "http-istegi")
	ctx = metadata.AppendToOutgoingContext(ctx, rpc.RequestIDKey, "req_saglik")

	if _, err := grpc_health_v1.NewHealthClient(conn).Check(ctx, &grpc_health_v1.HealthCheckRequest{}); err != nil {
		t.Fatalf("cagri basarisiz: %v", err)
	}
	parent.End()

	if spans := clientSpans(recorder); len(spans) != 0 {
		t.Errorf("saglik cagrisi span acmamali: %d span", len(spans))
	}
	if got := server.incoming.Get("traceparent"); len(got) != 0 {
		t.Errorf("saglik cagrisi traceparent tasimamali: %v", got)
	}
	if got := server.incoming.Get(rpc.RequestIDKey); len(got) != 1 || got[0] != "req_saglik" {
		t.Errorf("x-request-id yine gitmeli: %v", got)
	}
}
