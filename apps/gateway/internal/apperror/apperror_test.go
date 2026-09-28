package apperror

import (
	"errors"
	"net/http"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestTableMatchesCore(t *testing.T) {
	// Uretilen tablonun birkac tanik satiri. Tam esitligi "pnpm codes:go:check"
	// denetler; bu test uretecin YANLIS SUTUNU okumasi gibi hatalari yakalar.
	cases := map[Code]int{
		CodeValidationFailed:   http.StatusBadRequest,
		CodeNotFound:           http.StatusNotFound,
		CodeReservationExpired: http.StatusGone,
		CodeRiskReview:         http.StatusAccepted,
		CodeServiceUnavailable: http.StatusServiceUnavailable,
		CodeNotImplemented:     http.StatusNotImplemented,
	}
	for code, want := range cases {
		if got := HTTPStatus(code); got != want {
			t.Errorf("%s: %d bekleniyordu, %d geldi", code, want, got)
		}
		if Message(code) == "" {
			t.Errorf("%s icin mesaj bos", code)
		}
	}
}

func TestUnknownCodeFallsBackToInternal(t *testing.T) {
	if Known("UYDURMA") {
		t.Error("bilinmeyen kod taninmamali")
	}
	if HTTPStatus("UYDURMA") != http.StatusInternalServerError || Message("UYDURMA") != Message(CodeInternal) {
		t.Error("bilinmeyen kod INTERNAL gibi davranmali")
	}
}

func TestFromGRPCIgnoresUnknownCodeInPayload(t *testing.T) {
	// Servisin gonderdigi tanimadigimiz kod istemciye sizmamali; durum koduna dus.
	trailer := metadata.Pairs(MetadataKey, `{"code":"YENI_KOD","message":"x"}`)
	err := FromGRPC(status.Error(codes.NotFound, "x"), trailer)

	if err.Code != CodeNotFound {
		t.Errorf("NOT_FOUND bekleniyordu, %s geldi", err.Code)
	}
}

func TestFromGRPCIgnoresBrokenPayload(t *testing.T) {
	trailer := metadata.Pairs(MetadataKey, `{bozuk`)
	err := FromGRPC(status.Error(codes.InvalidArgument, "x"), trailer)

	if err.Code != CodeValidationFailed {
		t.Errorf("VALIDATION_FAILED bekleniyordu, %s geldi", err.Code)
	}
}

func TestFromGRPCDropsNonObjectDetails(t *testing.T) {
	// REST zarfi details'i NESNE bekler; dizi zarfi bozardi.
	trailer := metadata.Pairs(MetadataKey, `{"code":"VALIDATION_FAILED","message":"x","details":["a"]}`)
	err := FromGRPC(status.Error(codes.InvalidArgument, "x"), trailer)

	if err.Code != CodeValidationFailed || err.Details != nil {
		t.Errorf("kod korunmali, details dusmeli: %+v", err)
	}
}

func TestFromGRPCNotImplemented(t *testing.T) {
	// Yuk varsa (service-kit unimplemented, D5) kod yukten; yoksa durum kodundan
	// ayni koda dusulur - Node tarafindaki eslemeyle ayni.
	withPayload := FromGRPC(
		status.Error(codes.Unimplemented, "x"),
		metadata.Pairs(MetadataKey, `{"code":"NOT_IMPLEMENTED","message":"GetProduct henuz uygulanmadi (T8.4)"}`),
	)
	withoutPayload := FromGRPC(status.Error(codes.Unimplemented, "x"), nil)

	for _, err := range []*Error{withPayload, withoutPayload} {
		if err.Code != CodeNotImplemented || HTTPStatus(err.Code) != http.StatusNotImplemented {
			t.Errorf("NOT_IMPLEMENTED (501) bekleniyordu, %s geldi", err.Code)
		}
	}
}

func TestFromGRPCKeepsCause(t *testing.T) {
	cause := status.Error(codes.Internal, "ic ayrinti")
	err := FromGRPC(cause, nil)

	if !errors.Is(err, cause) {
		t.Error("asil hata gunluk icin korunmali (Unwrap)")
	}
}
