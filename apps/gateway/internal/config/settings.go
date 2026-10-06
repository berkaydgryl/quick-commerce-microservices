package config

import (
	"fmt"
	"log/slog"
	"net/mail"
	"net/url"
	"time"
)

// ServiceTarget, gateway'in konustugu tek bir gRPC servisi.
type ServiceTarget struct {
	// Kisa ad: gunlukte ve /healthz cevabinda gorunur ("catalog").
	Name string
	// host:port. NEDEN PORT DEGIL ADRES: gateway konteynerde calisirken servis
	// baska bir makinede ya da baska bir konteyner adinda olabilir; yalnizca port
	// tutmak "localhost" varsayimini koda gomerdi.
	Address string
}

// Config, dogrulanmis gateway yapilandirmasi.
type Config struct {
	Port            int
	NodeEnv         string
	LogLevel        slog.Level
	Mock            bool
	ShutdownTimeout time.Duration
	// Tek bir bagimli servise yapilan cagrinin ust siniri (/healthz dahil).
	RequestTimeout time.Duration
	// StockTimeout, urun listesindeki stok sorgusunun ust siniri (T8.4). Asilirsa
	// liste stoksuz doner; RequestTimeout'tan kisadir.
	StockTimeout time.Duration
	Services     []ServiceTarget
	// OTLPEndpoint, izlerin gonderilecegi OTLP/HTTP taban adresi (D15; ornek
	// http://localhost:4318). Bossa span'ler yine olusur ve servislere
	// tasinir (gunlukte traceId), yalnizca disari gonderilmez.
	OTLPEndpoint string

	// AssetBaseURL, gorsellerin mutlak adresinin koku. Veri gorseli GORELI yol
	// olarak saklar ("/img/cat/sut.png"); gateway (BFF) istemciye giden cevapta
	// bu koku ekler. Sonunda "/" yoktur.
	AssetBaseURL *url.URL
	// MongoURI, gateway'in koleksiyonlari (users, sessions; T8.1) icin; kendi
	// kullanicisini ve veritabanini tasir (GATEWAY_MONGO_URI, GATEWAY_MONGO_DB;
	// D14). MOCK'ta bos olabilir: kimlik kayitlari bellekte tutulur.
	MongoURI                    string
	MongoDB                     string
	MongoServerSelectionTimeout time.Duration
	// JWTSecret, erisim jetonunun imza sirri (HS256). Tipi Secret: yanlislikla
	// gunluge ya da hataya yazilsa bile "[gizli]" gorunur.
	JWTSecret Secret
	// RealtimeTokenSecret, oda jetonunun imza sirri (T12.2, HS256). JWTSecret'tan
	// farklidir; realtime-service ayni degerle dogrular.
	RealtimeTokenSecret Secret
	// JWTTTL, erisim jetonu omru; RefreshTTL, yenileme jetonu omru.
	JWTTTL     time.Duration
	RefreshTTL time.Duration
	// RedisURL, tekrar korumasi (T8.2) icin; MOCK'ta bos olabilir: kayitlar
	// bellekte tutulur. Adres parola tasiyabilir; gunluge yazilmaz.
	RedisURL            string
	RedisConnectTimeout time.Duration
	// IdempotencyTTL, bitmis idempotency kaydinin omru (ADR-08).
	IdempotencyTTL time.Duration
	// RateLimitEnabled false ise hiz siniri yoktur (yuk testleri; T8.2, P2).
	RateLimitEnabled bool
	// RateLimitWindow, kayan pencerenin uzunlugu.
	RateLimitWindow time.Duration
	// Pencere basina izin verilen istek: genel, kimlik uclari, siparis uclari.
	RateLimitGeneral int
	RateLimitAuth    int
	RateLimitOrder   int

	// GeoBaseURL, harita adres servisinin (Nominatim) kok adresi (T11.8).
	// Sonunda "/" yoktur.
	GeoBaseURL *url.URL
	// GeoUserAgent, Nominatim'e kendini tanitan ad (kullanim kosulu).
	GeoUserAgent string
	// GeoTimeout, tek adres sorusunun ust siniri: sirada bekleme (saniyede
	// bir istek) + Nominatim cevabi.
	GeoTimeout time.Duration

	// SMTPAddress, e-posta dogrulama kodunun gidecegi SMTP sunucusu, host:port
	// (T11.14; SMTP_URL). Bossa (yalnizca MOCK'ta, SMTP_URL verilmemisse)
	// iletiler bellekte kalir. Sifreli baglanti ve kimlik dogrulama yok:
	// bekleyen is #90.
	SMTPAddress string
	// MailFrom, iletinin gondereni (MAIL_FROM).
	MailFrom mail.Address
	// SMTPTimeout, tek iletinin ust siniri (SMTP_TIMEOUT_MS).
	SMTPTimeout time.Duration
}

// Addr, Fiber'in dinleyecegi adresi verir.
func (c Config) Addr() string {
	return fmt.Sprintf(":%d", c.Port)
}

// MetricsPort, /metrics ucunun portu: GATEWAY_PORT + 1000 (#29).
func (c Config) MetricsPort() int {
	return c.Port + MetricsPortOffset
}

// MetricsAddr, /metrics ucunun dinledigi adres.
func (c Config) MetricsAddr() string {
	return fmt.Sprintf(":%d", c.MetricsPort())
}
