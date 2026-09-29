// Package redisdb, gateway'in Redis baglantisidir (T8.2): idempotency kayitlari
// (ADR-08) ve hiz siniri (T8.2'nin ikinci PR'i).
//
// Anahtar bicimleri @getir/redis-kit keys.ts'tedir (tek kaynak); gateway onlari
// kendi paketlerinde uretir ve testleri keys.ts'teki satirla karsilastirir.
package redisdb

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// errBadURL, cozulemeyen REDIS_URL. Surucunun hatasi SARMALANMAZ: url
// paketinin mesaji adresi (varsa parolayi) oldugu gibi icerir.
var errBadURL = errors.New("REDIS_URL cozulemedi: redis:// ya da rediss:// bicimi bekleniyor")

// Options, baglanti ayarlari.
type Options struct {
	URL string
	// ConnectTimeout, baglanti kurma siniri (REDIS_CONNECT_TIMEOUT_MS; Node
	// servisleriyle ayni degisken).
	ConnectTimeout time.Duration
	// OperationTimeout, tek komutun okuma/yazma siniri. Istegin baglaminda son
	// tarih olmasa da takilan Redis istegi bekletmez (GATEWAY_REQUEST_TIMEOUT_MS).
	OperationTimeout time.Duration
}

// Connect, istemciyi kurar ve Redis'e ulasildigini dogrular (PING).
//
// NEDEN ACILISTA PING: istemci baglantiyi tembel kurar; ping olmadan Redis
// kapaliyken gateway "ayakta" gorunur ve ilk sipariste 503 donerdi. Hata
// acilisa cekilir (Mongo baglantisiyla ayni gerekce).
func Connect(ctx context.Context, opts Options) (*redis.Client, error) {
	parsed, err := clientOptions(opts)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(parsed)

	pingCtx, cancel := context.WithTimeout(ctx, opts.ConnectTimeout)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		if closeErr := client.Close(); closeErr != nil {
			return nil, fmt.Errorf("redis'e ulasilamadi: %w (kapatma: %w)", err, closeErr)
		}
		return nil, fmt.Errorf("redis'e ulasilamadi: %w", err)
	}
	return client, nil
}

// clientOptions, surucunun ayarlari.
//
// KOMUT YENIDEN DENENMEZ (MaxRetries -1; surucunun varsayilani 3): zaman asimina
// ugrayan komutu surucu sessizce tekrarlarsa istek sure sinirinin katlari
// kadar bekler (canli testte 2 sn sinirla 4,1 sn) ve cevabi kaybolmus bir
// SET NX tekrarlandiginda istek kendi kaydini "dolu" gorur. Yeniden denemeyi
// istemci yapar: ayni Idempotency-Key ile, guvenle. Baglanti kurma denemeleri
// (dial) ayri bir ayardir ve varsayilanda kalir.
func clientOptions(opts Options) (*redis.Options, error) {
	parsed, err := redis.ParseURL(opts.URL)
	if err != nil {
		return nil, errBadURL
	}
	parsed.DialTimeout = opts.ConnectTimeout
	parsed.ReadTimeout = opts.OperationTimeout
	parsed.WriteTimeout = opts.OperationTimeout
	parsed.MaxRetries = -1
	return parsed, nil
}

// Pinger, /healthz icin Redis'in ayakta olup olmadigini soyler.
type Pinger struct {
	client *redis.Client
}

// NewPinger, istemciyle kurar.
func NewPinger(client *redis.Client) Pinger {
	return Pinger{client: client}
}

// Ping, Redis cevap veriyor mu?
func (p Pinger) Ping(ctx context.Context) error {
	if err := p.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}
