package rpc

import (
	"context"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	grpccodes "google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// Span nitelikleri: Node servislerindeki (service-kit tracing.ts) adlarla AYNI,
// iz goruntuleyicide iki dilin span'leri ayni alanlarla aranir.
const (
	attrRPCSystem = "rpc.system"
	attrRPCSvc    = "rpc.service"
	attrRPCMethod = "rpc.method"
	attrRPCStatus = "rpc.grpc.status_code"
)

// healthMethodPrefix, gRPC saglik protokolunun metotlari. Saglik yoklamalari
// izlenmez (ADR-20): /healthz her yoklamada her servisi cagirir ve Node
// servislerinde de saglik RPC'leri span acmaz.
const healthMethodPrefix = "/grpc.health.v1.Health/"

// systemFailures, istemci span'ini HATALI isaretleyen durum kodlari: bagimli
// servis yok ya da cevap vermedi, yazilmamis uc, beklenmeyen ariza. Node'daki
// agirlik tablosunun (core ERROR_CODE_SEVERITY) gRPC karsiligi: is sonucu
// (FailedPrecondition, NotFound, AlreadyExists...) hata SAYILMAZ, sunucu
// span'iyle ayni karar verilir.
var systemFailures = map[grpccodes.Code]bool{
	grpccodes.Canceled:         true,
	grpccodes.Unknown:          true,
	grpccodes.DeadlineExceeded: true,
	grpccodes.Unimplemented:    true,
	grpccodes.Internal:         true,
	grpccodes.Unavailable:      true,
	grpccodes.DataLoss:         true,
}

// TracingInterceptor, giden her unary cagri icin bir istemci span'i acar ve
// traceparent'i metadata'ya yazar (D15, ADR-20): karsi servisin sunucu span'i
// bu cagrinin cocugu olur. Span, cagrinin baglamindaki (HTTP istegi) span'in
// cocugudur. Saglik cagrilari span acmadan ve traceparent yazmadan gecer.
func TracingInterceptor(tracer trace.Tracer, propagator propagation.TextMapPropagator) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		if strings.HasPrefix(method, healthMethodPrefix) {
			return invoker(ctx, method, req, reply, cc, opts...)
		}
		name := strings.TrimPrefix(method, "/")
		service, rpcMethod := splitMethod(name)
		ctx, span := tracer.Start(ctx, name,
			trace.WithSpanKind(trace.SpanKindClient),
			trace.WithAttributes(
				attribute.String(attrRPCSystem, "grpc"),
				attribute.String(attrRPCSvc, service),
				attribute.String(attrRPCMethod, rpcMethod),
			))
		defer span.End()

		outgoing, _ := metadata.FromOutgoingContext(ctx)
		outgoing = outgoing.Copy()
		propagator.Inject(ctx, metadataCarrier(outgoing))
		err := invoker(metadata.NewOutgoingContext(ctx, outgoing), method, req, reply, cc, opts...)

		code := status.Code(err)
		span.SetAttributes(attribute.Int(attrRPCStatus, int(code)))
		if systemFailures[code] {
			span.SetStatus(codes.Error, code.String())
		}
		return err
	}
}

// splitMethod, "getir.order.v1.OrderService/CreateOrder" -> servis ve metot.
func splitMethod(name string) (service, method string) {
	slash := strings.LastIndex(name, "/")
	if slash < 0 {
		return "", name
	}
	return name[:slash], name[slash+1:]
}

// metadataCarrier, gRPC metadata'sini W3C yayicisinin tasiyicisi yapar.
type metadataCarrier metadata.MD

func (c metadataCarrier) Get(key string) string {
	values := metadata.MD(c).Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func (c metadataCarrier) Set(key, value string) {
	metadata.MD(c).Set(key, value)
}

func (c metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for key := range c {
		keys = append(keys, key)
	}
	return keys
}
