// Package config, gateway'in ortam degiskenlerini okur ve dogrular.
//
// KURAL (Node tarafiyla ayni): ortam yalnizca BU paketten okunur ve eksik/gecersiz
// deger uygulamayi ACILISTA oldurur. Hatalar tek tek degil TOPLU dondurulur:
// uc degisken birden eksikse gelistirici uc kez yeniden baslatmak zorunda kalmasin.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Varsayilanlar. Roadmap'teki port haritasi ile birebir ayni.
const (
	defaultPort            = 8080
	defaultCatalogAddress  = "localhost:50051"
	defaultOrderAddress    = "localhost:50053"
	defaultShutdownTimeout = 10 * time.Second
	defaultRequestTimeout  = 5 * time.Second
	defaultLogLevel        = slog.LevelInfo
)

// Servis adlari: havuzdaki anahtar, gunluk alani ve /healthz'deki "name".
// Tek yerde tanimli; main ayni adla havuzdan baglanti ister.
const (
	CatalogService = "catalog"
	OrderService   = "order"
)

const (
	minPort = 1
	maxPort = 65535
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
	Services       []ServiceTarget
	// AssetBaseURL, gorsellerin mutlak adresinin koku. Veri gorseli GORELI yol
	// olarak saklar ("/img/cat/sut.png"); gateway (BFF) istemciye giden cevapta
	// bu koku ekler. Sonunda "/" yoktur.
	AssetBaseURL *url.URL
}

// Addr, Fiber'in dinleyecegi adresi verir.
func (c Config) Addr() string {
	return fmt.Sprintf(":%d", c.Port)
}

// Getenv, ortam okuyucusudur. Testte sahte bir fonksiyon verilir; boylece
// testler gercek ortami kirletmez ve paralel kosabilir.
type Getenv func(string) string

// Load, ortami okur ve dogrular. Birden fazla sorun varsa hepsi tek hatada birlesir.
func Load(getenv Getenv) (Config, error) {
	var problems []error

	port, err := readInt(getenv, "GATEWAY_PORT", defaultPort, minPort, maxPort)
	if err != nil {
		problems = append(problems, err)
	}

	level, err := readLogLevel(getenv)
	if err != nil {
		problems = append(problems, err)
	}

	mock, err := readBool(getenv, "MOCK", false)
	if err != nil {
		problems = append(problems, err)
	}

	shutdownTimeout, err := readDuration(getenv, "GRPC_SHUTDOWN_TIMEOUT_MS", defaultShutdownTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	requestTimeout, err := readDuration(getenv, "GATEWAY_REQUEST_TIMEOUT_MS", defaultRequestTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	nodeEnv, err := readEnum(getenv, "NODE_ENV", "development", []string{"development", "test", "production"})
	if err != nil {
		problems = append(problems, err)
	}

	assetBaseURL, err := readBaseURL(getenv, "ASSET_BASE_URL")
	if err != nil {
		problems = append(problems, err)
	}

	// Servis listesi bugun sabittir: gateway yalnizca ayakta olan iki servisi
	// taniyor. Yeni servis geldiginde buraya bir satir eklenir; adres yine
	// ortamdan gelir.
	services := []ServiceTarget{
		{Name: CatalogService, Address: readString(getenv, "CATALOG_GRPC_ADDR", defaultCatalogAddress)},
		{Name: OrderService, Address: readString(getenv, "ORDER_GRPC_ADDR", defaultOrderAddress)},
	}

	if len(problems) > 0 {
		return Config{}, fmt.Errorf("ortam degiskenleri gecersiz: %w", errors.Join(problems...))
	}

	return Config{
		Port:            port,
		NodeEnv:         nodeEnv,
		LogLevel:        level,
		Mock:            mock,
		ShutdownTimeout: shutdownTimeout,
		RequestTimeout:  requestTimeout,
		Services:        services,
		AssetBaseURL:    assetBaseURL,
	}, nil
}

// readString, bos metni "verilmedi" sayar (docker-compose "VAR=" boyle gecirir).
func readString(getenv Getenv, name, fallback string) string {
	if value := strings.TrimSpace(getenv(name)); value != "" {
		return value
	}
	return fallback
}

func readInt(getenv Getenv, name string, fallback, min, max int) (int, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: tam sayi bekleniyor, alinan %q: %w", name, raw, err)
	}
	if value < min || value > max {
		return 0, fmt.Errorf("%s: %d-%d araliginda olmali, alinan %d", name, min, max, value)
	}
	return value, nil
}

func readBool(getenv Getenv, name string, fallback bool) (bool, error) {
	raw := strings.ToLower(strings.TrimSpace(getenv(name)))
	switch raw {
	case "":
		return fallback, nil
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("%s: boolean bekleniyor (1/0, true/false), alinan %q", name, raw)
	}
}

// readDuration, milisaniye tasiyan degiskeni okur (*_MS sonekli degiskenler).
func readDuration(getenv Getenv, name string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return fallback, nil
	}

	milliseconds, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: milisaniye cinsinden tam sayi bekleniyor, alinan %q: %w", name, raw, err)
	}
	if milliseconds <= 0 {
		return 0, fmt.Errorf("%s: pozitif olmali, alinan %d", name, milliseconds)
	}
	return time.Duration(milliseconds) * time.Millisecond, nil
}

func readEnum(getenv Getenv, name, fallback string, allowed []string) (string, error) {
	value := readString(getenv, name, fallback)
	for _, candidate := range allowed {
		if value == candidate {
			return value, nil
		}
	}
	return "", fmt.Errorf("%s: %s degerlerinden biri olmali, alinan %q", name, strings.Join(allowed, "|"), value)
}

// assetBaseURLExample, eksik ASSET_BASE_URL hatasinda gosterilen ornek.
const assetBaseURLExample = "http://localhost:5173"

// readBaseURL, ZORUNLU bir mutlak http(s) kok adresini okur.
//
// NEDEN VARSAYILAN YOK: gorsellerin nerede barinacagi (web'in public/ klasoru,
// CDN, baska bir sunucu) henuz kararlastirilmadi. Bir varsayilan secmek o karari
// koda gomerdi; daha kotusu, canli ortamda degisken unutulursa istemciye
// "localhost" adresleri gider ve hata gurultu cikarmadan ekranda kirik gorsel
// olarak gorunurdu. Zorunlu tutmak hatayi acilisa (deploy anina) ceker.
//
// Kok adres sorgu (?) ve parca (#) tasiyamaz: yol eklendiginde anlamsiz adres
// uretirlerdi. Sondaki "/" atilir ki birlestirmede "//" olusmasin.
func readBaseURL(getenv Getenv, name string) (*url.URL, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return nil, fmt.Errorf("%s: zorunlu, ornek: %s", name, assetBaseURLExample)
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: gecerli bir adres degil, alinan %q: %w", name, raw, err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, fmt.Errorf("%s: http:// ya da https:// ile baslayan mutlak adres olmali, alinan %q", name, raw)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("%s: sorgu (?) ya da parca (#) tasiyamaz, alinan %q", name, raw)
	}

	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed, nil
}

// readLogLevel, LOG_LEVEL degiskenini slog seviyesine cevirir.
// Node tarafi pino seviyeleri kullaniyor; "trace" ve "fatal" Go'da karsiligi
// olmadigi icin en yakin seviyeye baglanir - iki taraf ayni degiskeni okusun diye.
func readLogLevel(getenv Getenv) (slog.Level, error) {
	switch strings.ToLower(readString(getenv, "LOG_LEVEL", "info")) {
	case "trace", "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error", "fatal":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("LOG_LEVEL: trace|debug|info|warn|error|fatal bekleniyor, alinan %q", getenv("LOG_LEVEL"))
	}
}
