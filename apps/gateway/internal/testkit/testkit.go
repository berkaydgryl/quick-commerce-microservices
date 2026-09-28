// Package testkit, gateway testlerinin ortak yardimcilaridir.
//
// YALNIZCA _test.go dosyalarindan ice aktarilir; uretim kodu bu paketi
// kullanmaz, bu yuzden ikiliye de girmez. Birden fazla paketin testinde ayni
// sekilde gereken adimlar buradadir: iki kopya bir gun birbirinden ayrilir
// (D8: catalog'daki kopya sunucu ve baglanti hatalarini yutuyordu, order'daki
// yutmuyordu).
package testkit

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// AppErrorOf, hatanin *apperror.Error oldugunu dogrular ve onu dondurur.
func AppErrorOf(t *testing.T, err error) *apperror.Error {
	t.Helper()
	var appErr *apperror.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("*apperror.Error bekleniyordu, %T geldi: %v", err, err)
	}
	return appErr
}

// JSON, degeri JSON metnine cevirir; kodlama hatasi testi durdurur.
func JSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("JSON kodlanamadi: %v", err)
	}
	return string(encoded)
}
