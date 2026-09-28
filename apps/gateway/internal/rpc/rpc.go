// Package rpc, gateway'in bagimli servis cagrilarinin ortak adimlaridir:
// cagri basina son tarih, x-app-error trailer'ini toplama, hatayi apperror'a
// indirme ve servisin alan adlarini REST adlarina cevirme.
//
// NEDEN AYRI PAKET (T7.5): bu adimlar once yalnizca catalog adaptorundeydi;
// order adaptoru de ayni yolu yurur. Uc eklemek bu adimlari kopyalamayi
// gerektirmesin diye jeneriktir ve tek yerdedir.
package rpc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Unary, uretilen istemcideki tek bir unary metodun imzasi.
type Unary[Req, Resp any] func(ctx context.Context, in *Req, opts ...grpc.CallOption) (*Resp, error)

// Invoke, tek bir unary cagriyi yapar. Hata her zaman *apperror.Error'dur:
// servis hatasi (x-app-error) varsa onun kodu ve ayrintisi, yoksa gRPC durum
// kodundan turetilen kod.
//
// service ve method yalnizca gunluge giden hata metnindedir ("order CreateOrder").
func Invoke[Req, Resp any](ctx context.Context, timeout time.Duration, service, method string, call Unary[Req, Resp], request *Req) (*Resp, error) {
	// Son tarih cagri basinadir: istemci baglantiyi acik tutsa bile takilan bir
	// servis gateway'in goroutine'ini sonsuza kadar bekletmesin.
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Servis hatasinin is anlami trailer'daki x-app-error'dadir; toplamazsak
	// her hata yalnizca durum kodundan tahmin edilir.
	var trailer metadata.MD
	response, err := call(callCtx, request, grpc.Trailer(&trailer))
	if err != nil {
		return nil, apperror.FromGRPC(fmt.Errorf("%s %s: %w", service, method, err), trailer)
	}
	return response, nil
}

// RenameFields, servisin DOGRULAMA hatasindaki proto alan adlarini istemcinin
// gonderdigi REST adlarina cevirir ("query" -> "q"). Istemci hatayi kendi
// gonderdigi adla gormeli. rename, eslemesi olmayan adi OLDUGU GIBI dondurur.
//
// YALNIZCA VALIDATION_FAILED: orada anahtarlar istemcinin girdisidir. Diger
// hatalarin ayrintisi baglamdir (NOT_FOUND {orderId}, PAYMENT_DECLINED
// {orderId, status}) ve her uctan ayni adla donmeli; T7.5 canli testinde 404
// ayrintisi "orderId" yerine "id" olarak cikiyordu. Hata apperror degilse ya da
// ayrintisi yoksa dokunulmaz.
func RenameFields(err error, rename func(field string) string) error {
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeValidationFailed || len(appErr.Details) == 0 {
		return err
	}
	renamed := make(map[string]any, len(appErr.Details))
	for field, value := range appErr.Details {
		renamed[rename(field)] = value
	}
	return &apperror.Error{Code: appErr.Code, Details: renamed, Cause: appErr.Cause}
}

// Names, sabit ad eslemesinden bir rename fonksiyonu kurar.
func Names(names map[string]string) func(string) string {
	return func(field string) string {
		if restName, ok := names[field]; ok {
			return restName
		}
		return field
	}
}
