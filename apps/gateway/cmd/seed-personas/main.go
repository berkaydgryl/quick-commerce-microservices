// seed-personas, demo personalarini gateway'in Mongo'suna yazar (T8.1):
// hesaplar, demo sifresi, hesabin acildigi cihaz, son bilinen konum ve hazir
// adresler. Siparis gecmisleri order-service'in seed'indedir (ADR-05).
//
//	pnpm seed:personas          (kokten: order-service gecmisiyle birlikte, .env ile)
//	go run ./cmd/seed-personas  (apps/gateway icinden; ortam degiskenleri kabukta)
//
// Tekrar calistirmak GUVENLIDIR: personalarin kayitlari ve oturumlari silinip
// yeniden yazilir; hesap yaslari calisma anina gore yeniden hesaplanir (Zeynep
// ve Can yine "24 saatten yeni" olur). NODE_ENV=production iken reddeder.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/persona"
)

// seedFailureExitCode, seed basarisiz oldugunda cikis kodu (catalog seed'iyle ayni).
const seedFailureExitCode = 1

// operationTimeout, tek bir Mongo isleminin ust siniri.
const operationTimeout = 30 * time.Second

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With(slog.String("service", "gateway-seed"))
	if err := run(context.Background(), os.Getenv, logger); err != nil {
		logger.Error("persona seed basarisiz", slog.Any("err", err))
		os.Exit(seedFailureExitCode)
	}
}

// run, seed'in sirasi: ortam -> production denetimi -> veri -> Mongo -> yaz.
// Veri ve ortam hatalari Mongo'ya baglanmadan once doner.
func run(ctx context.Context, getenv config.Getenv, logger *slog.Logger) (err error) {
	cfg, err := config.LoadSeed(getenv)
	if err != nil {
		return err
	}
	if err := persona.Allowed(cfg.NodeEnv); err != nil {
		return err
	}
	set, err := persona.Load()
	if err != nil {
		return err
	}
	hasher, err := auth.NewPasswordHasher(auth.DefaultPasswordCost)
	if err != nil {
		return err
	}
	passwordHash, err := hasher.Hash(set.Password)
	if err != nil {
		return err
	}

	client, err := mongodb.Connect(ctx, mongodb.Options{
		URI: cfg.MongoURI, ServerSelectionTimeout: cfg.MongoServerSelectionTimeout, OperationTimeout: operationTimeout,
	})
	if err != nil {
		return err
	}
	defer func() {
		if disconnectErr := client.Disconnect(context.WithoutCancel(ctx)); disconnectErr != nil && err == nil {
			err = fmt.Errorf("mongo baglantisi kapatilamadi: %w", disconnectErr)
		}
	}()

	db := client.Database(cfg.MongoDB)
	if err := authstore.EnsureIndexes(ctx, db); err != nil {
		return err
	}
	users := set.Users(time.Now(), passwordHash)
	if err := authstore.ReplaceUsers(ctx, db, users); err != nil {
		return err
	}
	logger.Info("personalar yazildi", slog.String("db", cfg.MongoDB), slog.Int("hesap", len(users)))
	return nil
}
