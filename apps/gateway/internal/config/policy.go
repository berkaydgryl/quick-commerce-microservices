package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"strings"
)

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
