package main

import (
	"fmt"
	"net/http"
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
func runHealthcheck(port int) int {
	client := &http.Client{Timeout: healthcheckTimeout}

	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", port))
	if err != nil {
		return exitUnhealthy
	}
	defer func() { _ = response.Body.Close() }()

	// 503 (bagimli servis dusuk) da saglikli DEGILDIR: bu durumda gateway
	// istekleri karsilayamaz ve orkestrator onu trafikten cekmelidir.
	if response.StatusCode != http.StatusOK {
		return exitUnhealthy
	}
	return exitHealthy
}
