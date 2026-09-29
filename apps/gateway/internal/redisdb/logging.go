package redisdb

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/redis/go-redis/v9"
)

// driverLogger, surucunun (go-redis) gunluk satirlarini slog'a yonlendirir.
//
// NEDEN: surucu varsayilan olarak stderr'e DUZ METIN yazar ("redis: 2026/09/29
// 12:47:26 pool.go:762: ... failed to dial"); gateway'in butun gunlugu JSON'dur.
// Redis dustugunde her baglanti denemesi bir satir yazar: o satir da
// toplayicinin okuyabilecegi bicimde, servis adiyla birlikte gitmeli.
type driverLogger struct {
	logger *slog.Logger
}

// Printf, surucunun gunluk arayuzu (go-redis internal.Logging).
func (d driverLogger) Printf(ctx context.Context, format string, v ...any) {
	d.logger.WarnContext(ctx, "redis surucusu", slog.String("detail", fmt.Sprintf(format, v...)))
}

// RouteDriverLogs, surucunun gunlugunu verilen gunluge baglar. Surucu gunlugu
// paket geneli bir degiskendir (redis.SetLogger): surec basinda, HICBIR
// istemci kurulmadan once bir kez cagrilir. Sonradan cagirmak, onceki
// istemcilerin arka plan goroutine'leri (bitmemis baglanti denemeleri) o
// degiskeni okurken yazmak demektir: data race.
func RouteDriverLogs(logger *slog.Logger) {
	redis.SetLogger(driverLogger{logger: logger})
}
