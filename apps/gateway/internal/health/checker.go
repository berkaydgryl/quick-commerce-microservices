// Package health, bagimli servislerin durumunu toplar.
//
// Kaynak: standart grpc.health.v1 sozlesmesi. Her Node servisi bunu
// @getir/service-kit uzerinden konusuyor (T2.4), bu yuzden gateway'in ayri bir
// "ping" ucuna ihtiyaci yok.
package health

import (
	"context"
	"sort"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

// Durum degerleri. SERVING/NOT_SERVING sozlesmeden gelir; UNREACHABLE bizim
// eklememizdir: "servis cevap vermedi" ile "servis kendini hasta bildirdi"
// ayni sey degildir ve operasyonda farkli anlama gelir.
const (
	StatusServing     = "SERVING"
	StatusNotServing  = "NOT_SERVING"
	StatusUnreachable = "UNREACHABLE"
)

// Rapor durumlari.
const (
	ReportOK       = "ok"
	ReportDegraded = "degraded"
)

// Client, grpc.health.v1 istemcisinin BIZE LAZIM OLAN kadari.
//
// Arayuz burada - yani KULLANAN tarafta - tanimlanir ve tek metotludur; boylece
// testte sahte bir istemci vermek icin kutuphaneyi taklit etmek gerekmez.
type Client interface {
	Check(ctx context.Context, in *grpc_health_v1.HealthCheckRequest, opts ...grpc.CallOption) (*grpc_health_v1.HealthCheckResponse, error)
}

// Pinger, gRPC konusmayan bir bagimliligin (Mongo, T8.1) ayakta olup olmadigini
// soyler. Tek metotlu ve KULLANAN tarafta: testte sahtesi bir fonksiyondur.
type Pinger interface {
	Ping(ctx context.Context) error
}

// pingFailure, ulasilamayan gRPC disi bagimlilikta rapora yazilan kod. Surucunun
// mesaji ic ag adresini tasir; /healthz disariya acik oldugu icin o ayrinti
// cevaba KONMAZ (gRPC servislerindeki kuralla ayni).
const pingFailure = "Unavailable"

// ServiceStatus, tek bir servisin raporu.
type ServiceStatus struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	LatencyMs int64  `json:"latencyMs"`
	// Yalnizca ulasilamayan serviste dolu ve yalnizca gRPC DURUM KODUDUR
	// ("Unavailable", "DeadlineExceeded"). Surucunun tam mesaji ic ag adresini
	// ve portu tasir; /healthz disariya acik oldugu icin o ayrinti cevaba
	// KONMAZ - operasyon icin kod yeterlidir, ayrinti gunluge yazilir.
	Error string `json:"error,omitempty"`
}

// Report, /healthz cevabinin govdesi.
type Report struct {
	Status   string          `json:"status"`
	Mock     bool            `json:"mock"`
	Services []ServiceStatus `json:"services"`
}

// Healthy, tum servisler ayakta mi?
func (r Report) Healthy() bool {
	return r.Status == ReportOK
}

// Checker, kayitli servisleri ve bagimliliklari paralel sorgular.
type Checker struct {
	clients map[string]Client
	pingers map[string]Pinger
	timeout time.Duration
	mock    bool
}

// New, ada gore gRPC istemcilerinden ve gRPC disi bagimliliklardan (Mongo)
// bir denetleyici kurar. pingers bos olabilir (MOCK'ta Mongo yoktur).
func New(clients map[string]Client, pingers map[string]Pinger, timeout time.Duration, mock bool) *Checker {
	return &Checker{clients: clients, pingers: pingers, timeout: timeout, mock: mock}
}

// Check, tum servisleri AYNI ANDA sorgular.
//
// Paralel olmasi onemli: sirayla sorulsaydi, her biri zaman asimina ugrayan uc
// servis /healthz'i 3 x timeout kadar bekletirdi ve probe'lar bosuna duserdi.
func (c *Checker) Check(ctx context.Context) Report {
	statuses := make([]ServiceStatus, len(c.clients)+len(c.pingers))

	var wait sync.WaitGroup
	index := 0
	for name, client := range c.clients {
		wait.Add(1)
		go func(position int, name string, client Client) {
			defer wait.Done()
			statuses[position] = c.checkOne(ctx, name, client)
		}(index, name, client)
		index++
	}
	for name, pinger := range c.pingers {
		wait.Add(1)
		go func(position int, name string, pinger Pinger) {
			defer wait.Done()
			statuses[position] = c.pingOne(ctx, name, pinger)
		}(index, name, pinger)
		index++
	}
	wait.Wait()

	// Harita sirasi rastgeledir; cevap her istekte ayni sirada donsun.
	sort.Slice(statuses, func(left, right int) bool {
		return statuses[left].Name < statuses[right].Name
	})

	report := Report{Status: ReportOK, Mock: c.mock, Services: statuses}
	for _, status := range statuses {
		if status.Status != StatusServing {
			report.Status = ReportDegraded
			break
		}
	}
	return report
}

func (c *Checker) checkOne(ctx context.Context, name string, client Client) ServiceStatus {
	// Her cagri kendi son tarihini tasir: bir servis takilirsa digerlerinin
	// cevabini geciktirmesin.
	callCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	startedAt := time.Now()
	// Bos servis adi = "butun sunucu ayakta mi?" (sozlesme boyle tanimlar).
	response, err := client.Check(callCtx, &grpc_health_v1.HealthCheckRequest{Service: ""})
	latency := time.Since(startedAt).Milliseconds()

	if err != nil {
		return ServiceStatus{
			Name:      name,
			Status:    StatusUnreachable,
			LatencyMs: latency,
			Error:     status.Code(err).String(),
		}
	}

	status := StatusNotServing
	if response.GetStatus() == grpc_health_v1.HealthCheckResponse_SERVING {
		status = StatusServing
	}
	return ServiceStatus{Name: name, Status: status, LatencyMs: latency}
}

// pingOne, gRPC disi bagimliligi ayni son tarih kuraliyla sorar.
func (c *Checker) pingOne(ctx context.Context, name string, pinger Pinger) ServiceStatus {
	callCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	startedAt := time.Now()
	err := pinger.Ping(callCtx)
	latency := time.Since(startedAt).Milliseconds()
	if err != nil {
		return ServiceStatus{Name: name, Status: StatusUnreachable, LatencyMs: latency, Error: pingFailure}
	}
	return ServiceStatus{Name: name, Status: StatusServing, LatencyMs: latency}
}
