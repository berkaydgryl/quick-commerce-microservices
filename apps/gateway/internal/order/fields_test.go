package order

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

func TestReserveRenamesProtoFieldsToRestFields(t *testing.T) {
	stub := &stubServer{
		err: status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey,
			`{"code":"VALIDATION_FAILED","message":"x","details":{"lines.0.quantity":"en fazla 99","deliveryLocation.lat":"en fazla 90","deliveryAddress":"zorunlu","idempotencyKey":"en az 8","marketId":"gecersiz"}}`),
	}
	service := startStub(t, stub)

	_, err := service.Reserve(context.Background(), reserveInput())

	details := testkit.AppErrorOf(t, err).Details
	want := map[string]string{
		"items.0.quantity":     "en fazla 99",
		"address.location.lat": "en fazla 90",
		"address.line":         "zorunlu",
		"Idempotency-Key":      "en az 8",
		"marketId":             "gecersiz",
	}
	for field, reason := range want {
		if details[field] != reason {
			t.Errorf("%s = %v, %q bekleniyordu (tum details: %v)", field, details[field], reason, details)
		}
	}
	if len(details) != len(want) {
		t.Errorf("proto adlari kalmamali: %v", details)
	}
}
