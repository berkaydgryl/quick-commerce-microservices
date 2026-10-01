package config

import (
	"errors"
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

// mongoURIExample, eksik GATEWAY_MONGO_URI hatasinda gosterilen ornek
// (.env.example bicimi; parola yerine yer tutucu).
const mongoURIExample = "mongodb://gateway:<parola>@localhost:27017/?directConnection=true&authSource=admin"

// readMongoURI, MOCK disinda ZORUNLU Mongo adresini okur (T8.1). MOCK'ta kimlik
// kayitlari bellekte tutulur; adres verilse de kullanilmaz.
//
// Adres gateway'in KENDI kullanicisini tasir (D14, ADR-05): yalnizca kendi
// veritabaninda (users, sessions) yetkili. Hata metni adresi ICERMEZ: parola
// tasir.
func readMongoURI(getenv Getenv, mock bool) (string, error) {
	uri := readString(getenv, "GATEWAY_MONGO_URI", "")
	if uri == "" && !mock {
		return "", fmt.Errorf("GATEWAY_MONGO_URI: MOCK=true degilse zorunlu, ornek: %s", mongoURIExample)
	}
	return uri, nil
}

// redisURLExample, eksik REDIS_URL hatasinda gosterilen ornek (.env.example).
const redisURLExample = "redis://localhost:6379"

// readRedisURL, MOCK disinda ZORUNLU Redis adresini okur (T8.2): tekrar
// korumasi olmadan siparis acilmaz. MOCK'ta kayitlar bellekte tutulur.
//
// Hata metni adresi ICERMEZ: adres parola tasiyabilir (redis://:parola@host).
func readRedisURL(getenv Getenv, mock bool) (string, error) {
	raw := readString(getenv, "REDIS_URL", "")
	if raw == "" {
		if mock {
			return "", nil
		}
		return "", fmt.Errorf("REDIS_URL: MOCK=true degilse zorunlu, ornek: %s", redisURLExample)
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "redis" && parsed.Scheme != "rediss") || parsed.Host == "" {
		return "", fmt.Errorf("REDIS_URL: redis:// ya da rediss:// ile baslayan bir adres olmali, ornek: %s", redisURLExample)
	}
	return raw, nil
}

// readJWTSecret, erisim jetonunun imza sirrini okur (ZORUNLU, T8.1).
//
// En az 32 bayt: HS256 icin daha kisa sir kaba kuvvete aciktir. Production'da
// .env.example'daki ornek deger REDDEDILIR: ornegi kopyalayip degistirmeyi
// unutmak, herkesin bildigi bir sirla jeton imzalamak demekti. Hata metni
// sirrin kendisini ASLA icermez.
func readJWTSecret(getenv Getenv, nodeEnv string) (Secret, error) {
	value := strings.TrimSpace(getenv("JWT_SECRET"))
	switch {
	case value == "":
		return nil, fmt.Errorf("JWT_SECRET: zorunlu, en az %d bayt; uretmek icin: openssl rand -hex 32", minJWTSecretBytes)
	case len(value) < minJWTSecretBytes:
		return nil, fmt.Errorf("JWT_SECRET: en az %d bayt olmali, verilen %d bayt", minJWTSecretBytes, len(value))
	case nodeEnv == EnvProduction && value == exampleJWTSecret:
		return nil, errors.New("JWT_SECRET: production'da .env.example'daki ornek sir kullanilamaz")
	}
	return Secret(value), nil
}
