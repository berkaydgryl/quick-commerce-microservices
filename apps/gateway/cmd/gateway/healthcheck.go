package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"
)

// healthcheckArg, Docker HEALTHCHECK'in kullandigi alt komut.
//
// NEDEN AYRI BIR IKILI DEGIL DE ALT KOMUT: calisma imaji distroless, yani
// icinde kabuk ve curl YOK. Saglik kontrolu icin imaja ayri bir arac koymak
// (curl, grpc_health_probe) hem boyut hem guvenlik yuzeyi demek. Zaten orada
// olan ikiliye tek bir alt komut eklemek bedavaya gelir.
const healthcheckArg = "healthcheck"

const (
	healthcheckTimeout = 2 * time.Second
	exitHealthy        = 0
	exitUnhealthy      = 1
)

// runHealthcheck, kendi /healthz ucunu cagirir. Docker'in bekledigi sozlesme:
// 0 = saglikli, 1 = degil.
//
// Son tarih BAGLAMDADIR (D8): baglanti, cevap ve govde ayni sureye tabidir;
// takilan bir gateway probe'u da takmaz. Sebep stderr'e yazilir: Docker onu
// saglik kaydinda saklar (`docker inspect`), "neden saglikli degil" gorulur.
func runHealthcheck(ctx context.Context, port int) int {
	ctx, cancel := context.WithTimeout(ctx, healthcheckTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/healthz", port), nil)
	if err != nil {
		reportHealthcheckError("istek kurulamadi", err)
		return exitUnhealthy
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		reportHealthcheckError("istek basarisiz", err)
		return exitUnhealthy
	}
	defer closeHealthcheckBody(response)

	// 503 (bagimli servis dusuk) da saglikli DEGILDIR: bu durumda gateway
	// istekleri karsilayamaz ve orkestrator onu trafikten cekmelidir.
	if response.StatusCode != http.StatusOK {
		return exitUnhealthy
	}
	return exitHealthy
}

// closeHealthcheckBody, cevap govdesini kapatir. Kapatma hatasi sonucu
// degistirmez (durum kodu zaten okundu) ama yutulmaz, stderr'e yazilir.
func closeHealthcheckBody(response *http.Response) {
	if err := response.Body.Close(); err != nil {
		reportHealthcheckError("cevap govdesi kapatilamadi", err)
	}
}

func reportHealthcheckError(step string, err error) {
	fmt.Fprintf(os.Stderr, "healthcheck: %s: %v\n", step, err)
}
