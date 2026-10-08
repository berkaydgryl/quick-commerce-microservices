package tracking

import (
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Courier hatasinin ayrintisi istemciye IZIN LISTESIYLE gecer (#187): yalnizca
// VALIDATION_FAILED'in siparis kimligi alani (REST'te "id"); NOT_FOUND ucun tek
// 404'udur (tracking_test.go); baska her kod ayrintisiz. Kod korunur, courier'in
// mesaj metni gunluge de gitmez (#179).

// courierSecrets, courier ayrintisinda olup istemciye gitmemesi gerekenler.
const courierSecrets = `"courierId":"` + testCourierID + `","location":{"lat":41.0082,"lng":28.9784},"otherOrderId":"ord_0123456789abcdef0123456789abcdef"`

func courierFailure(grpcCode codes.Code, appCode apperror.Code, details string) *fakeCourier {
	return &fakeCourier{
		err: status.Error(grpcCode, "Mehmet Kaya 41.0082,28.9784"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"`+string(appCode)+`","message":"Mehmet Kaya 41.0082,28.9784",`+
			`"details":{`+details+`}}`),
	}
}

func TestTrackCourierErrorDetailsPassOnlyThroughTheAllowList(t *testing.T) {
	for _, tc := range []struct {
		name    string
		courier *fakeCourier
		code    apperror.Code
		details string
	}{
		{"dogrulama: yalnizca siparis kimligi, REST adiyla", courierFailure(codes.InvalidArgument, apperror.CodeValidationFailed, `"orderId":"bicimsiz",`+courierSecrets),
			apperror.CodeValidationFailed, `{"id":"bicimsiz"}`},
		{"dogrulama: siparis kimligi alani yoksa ayrintisiz", courierFailure(codes.InvalidArgument, apperror.CodeValidationFailed, courierSecrets),
			apperror.CodeValidationFailed, `null`},
		{"dogrulama: siparis kimligi alani metin degilse ayrintisiz", courierFailure(codes.InvalidArgument, apperror.CodeValidationFailed, `"orderId":{`+courierSecrets+`}`),
			apperror.CodeValidationFailed, `null`},
		{"dogrulama: siparis kimligi alani dizi ise ayrintisiz", courierFailure(codes.InvalidArgument, apperror.CodeValidationFailed, `"orderId":["`+testCourierID+`"]`),
			apperror.CodeValidationFailed, `null`},
		{"durum gecersiz: ayrintisiz", courierFailure(codes.FailedPrecondition, apperror.CodeOrderStateInvalid, `"status":"ON_THE_WAY",`+courierSecrets),
			apperror.CodeOrderStateInvalid, `null`},
		{"cakisma: ayrintisiz", courierFailure(codes.Aborted, apperror.CodeConflict, `"orderId":"`+testOrderID+`",`+courierSecrets),
			apperror.CodeConflict, `null`},
		{"ic hata: ayrintisiz", courierFailure(codes.Internal, apperror.CodeInternal, courierSecrets),
			apperror.CodeInternal, `null`},
		{"ulasilamaz: ayrintisiz", courierFailure(codes.Unavailable, apperror.CodeServiceUnavailable, courierSecrets),
			apperror.CodeServiceUnavailable, `null`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := newService(&fakeOrders{status: "ON_THE_WAY"}, tc.courier).Track(t.Context(), testUserID, testOrderID)

			appErr := testkit.AppErrorOf(t, err)
			if appErr.Code != tc.code {
				t.Errorf("kod korunmali: %s, beklenen %s", appErr.Code, tc.code)
			}
			if got := testkit.JSON(t, appErr.Details); got != tc.details {
				t.Errorf("istemciye giden ayrinti %s, beklenen %s", got, tc.details)
			}
			if text := err.Error(); strings.Contains(text, "Mehmet") || strings.Contains(text, "41.0082") || strings.Contains(text, testCourierID) {
				t.Errorf("gunluge giden metin courier verisi tasimamali: %s", text)
			}
		})
	}
}
