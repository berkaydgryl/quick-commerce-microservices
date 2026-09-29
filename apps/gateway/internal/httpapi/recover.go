package httpapi

import (
	"fmt"
	"runtime/debug"

	"github.com/gofiber/fiber/v3"
	fiberrecover "github.com/gofiber/fiber/v3/middleware/recover"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Panik kurtarma (T8.3). Fiber panigi kendiliginden yakalamaz: bir uctaki
// beklenmedik panik (bos isaretci, sinir disi dizin) butun gateway surecini
// dusurur ve o an bagli her istemci etkilenir. Bu ara katman panigi bir
// hataya cevirir; hata isleyici (errors.go) onu 500 INTERNAL zarfina cevirir
// ve panik degerini yigin iziyle gunluge yazar. Deger ve yigin izi cevaba
// GIRMEZ.
//
// Panigin degeri cevabi BELIRLEMEZ. Fiber'in varsayilan isleyicisi deger bir
// error ise onu aynen kullanirdi: panic(NOT_FOUND hatasi) 404 olurdu. Panik
// her zaman bir hatadir, cevap her zaman INTERNAL'dir.

// recoveredPanic, yakalanan panik: degeri ve yigin izi yalnizca gunluge gider.
type recoveredPanic struct {
	value string
	stack string
}

func (p *recoveredPanic) Error() string {
	return "uc panikledi: " + p.value
}

// recoverPanics, istek gunlugunun ICINDE calisir (router.go): panik hataya
// donunce istek gunlugu 500'u ve ayni requestId'yi yazar. Disarida olsaydi
// panik gunluk ara katmaninin icinden gecerken o satir hic yazilmazdi.
func recoverPanics() fiber.Handler {
	return fiberrecover.New(fiberrecover.Config{
		PanicHandler: func(_ fiber.Ctx, value any) error {
			// Yigin izi ertelenen fonksiyonun icinde alinir: yigin henuz
			// sokulmemistir, iz panigin cikis noktasini gosterir.
			return &apperror.Error{
				Code:  apperror.CodeInternal,
				Cause: &recoveredPanic{value: fmt.Sprint(value), stack: string(debug.Stack())},
			}
		},
	})
}
