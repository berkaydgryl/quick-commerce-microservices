package config

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"net/url"
	"strings"
)

// assetBaseURLExample, eksik ASSET_BASE_URL hatasinda gosterilen ornek.
const assetBaseURLExample = "http://localhost:5173"

// otlpEndpointExample, gecersiz OTEL_EXPORTER_OTLP_ENDPOINT hatasinda gosterilen
// ornek (docker-compose.dev.yml'deki Jaeger).
const otlpEndpointExample = "http://localhost:4318"

// readOptionalHTTPURL, ISTEGE BAGLI bir http(s) adresini okur (D15: izlerin
// gonderilecegi OTLP/HTTP taban adresi). Bossa "" (ozellik kapali). Sondaki
// "/" atilir ki yol eklenince "//" olusmasin. Hata metni degeri ICERMEZ: adres
// kimlik bilgisi tasiyabilir.
func readOptionalHTTPURL(getenv Getenv, name string) (string, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return "", nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", fmt.Errorf("%s: http:// ya da https:// ile baslayan bir adres olmali, ornek: %s", name, otlpEndpointExample)
	}
	return strings.TrimRight(raw, "/"), nil
}

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

// readRealtimeTokenSecret, oda jetonunun imza sirrini okur (ZORUNLU, T12.2).
//
// Kurallar JWT_SECRET'inkiyle ayni (en az 32 bayt, production'da ornek deger
// yok) ve BIR fazlasi: erisim jetonunun sirriyla AYNI OLAMAZ. Iki sir ayri
// tutulur ki biri sizarsa digeri gecerli kalsin; ikisinin bir arada durdugu tek
// yer gateway oldugu icin esitlik burada denetlenir (realtime JWT_SECRET'i
// bilmez). Ayni deger realtime-service'e de verilir. Hata metni sirri icermez.
func readRealtimeTokenSecret(getenv Getenv, nodeEnv string, jwtSecret Secret) (Secret, error) {
	const name = "REALTIME_TOKEN_SECRET"
	value := strings.TrimSpace(getenv(name))
	switch {
	case value == "":
		return nil, fmt.Errorf("%s: zorunlu, en az %d bayt, realtime ile ayni deger; uretmek icin: openssl rand -hex 32", name, minJWTSecretBytes)
	case len(value) < minJWTSecretBytes:
		return nil, fmt.Errorf("%s: en az %d bayt olmali, verilen %d bayt", name, minJWTSecretBytes, len(value))
	case nodeEnv == EnvProduction && value == exampleRealtimeTokenSecret:
		return nil, fmt.Errorf("%s: production'da .env.example'daki ornek sir kullanilamaz", name)
	case len(jwtSecret) > 0 && subtle.ConstantTimeCompare([]byte(value), jwtSecret.Bytes()) == 1:
		return nil, fmt.Errorf("%s: JWT_SECRET ile ayni olamaz; iki jeton ayri sirla imzalanir", name)
	}
	return Secret(value), nil
}

// readGeoBaseURL, harita adres servisinin (Nominatim) kok adresi (T11.8).
// Verilmezse OpenStreetMap'in genel sunucusu: demo icin ucretsiz ve hesapsiz.
// Kendi Nominatim'ini kuran ortam (ya da test) degistirir. Kok adres sorgu
// ve parca tasiyamaz; sondaki "/" atilir.
func readGeoBaseURL(getenv Getenv) (*url.URL, error) {
	const name = "GEO_BASE_URL"
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		raw = defaultGeoBaseURL
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("%s: http(s) ile baslayan, sorgusuz bir kok adres olmali, ornek: %s", name, defaultGeoBaseURL)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed, nil
}

// readSMTPAddress, e-posta dogrulama kodunun SMTP sunucusu (T11.14): smtp://host:port.
//
// Verilmezse: MOCK'ta "" (iletiler bellekte; altyapisiz gelistirme), production'da
// HATA (canli ortam adresini acikca verir), aksi halde compose'daki Mailpit.
// Bugun yalnizca sifresiz SMTP: kullanici adi/parola ve smtps:// reddedilir;
// TLS ve kimlik dogrulama bekleyen is #90. Hata metni degeri ICERMEZ.
func readSMTPAddress(getenv Getenv, mock bool, nodeEnv string) (string, error) {
	const name = "SMTP_URL"
	raw := strings.TrimSpace(getenv(name))
	switch {
	case raw == "" && mock:
		return "", nil
	case raw == "" && nodeEnv == EnvProduction:
		return "", fmt.Errorf("%s: production'da zorunlu, ornek: %s", name, defaultSMTPURL)
	case raw == "":
		raw = defaultSMTPURL
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "smtp" || parsed.Hostname() == "" || parsed.Port() == "" ||
		parsed.User != nil || strings.Trim(parsed.Path, "/") != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s: smtp://host:port biciminde olmali (kimlik bilgisi ve TLS bugun yok, bekleyen is #90), ornek: %s", name, defaultSMTPURL)
	}
	return parsed.Host, nil
}

// readMailFrom, iletinin gondereni (T11.14): "Ad <adres>" ya da yalnizca adres.
func readMailFrom(getenv Getenv) (mail.Address, error) {
	const name = "MAIL_FROM"
	raw := readString(getenv, name, defaultMailFrom)
	address, err := mail.ParseAddress(raw)
	if err != nil {
		return mail.Address{}, fmt.Errorf("%s: gecerli bir e-posta adresi olmali, ornek: %s", name, defaultMailFrom)
	}
	return *address, nil
}
