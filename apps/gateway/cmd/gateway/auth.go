package main

import (
	"context"
	"fmt"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/persona"
)

// mongoHealthName, /healthz raporunda Mongo'nun adi.
const mongoHealthName = "mongo"

// authParts, kimlik icin kurulan parcalar (T8.1).
type authParts struct {
	service *auth.Service
	tokens  *auth.Tokens
	// pingers, /healthz'ye eklenen bagimliliklar; MOCK'ta bos.
	pingers map[string]health.Pinger
	// close, Mongo baglantisini birakir; MOCK'ta bir sey yapmaz.
	close func(ctx context.Context) error
	// personas, MOCK'ta bellege yuklenen persona hesabi sayisi (gunluk icin).
	personas int
}

// buildAuth, kimlik servisini kurar. passwordCost bcrypt maliyetidir: gercek
// acilista auth.DefaultPasswordCost, testte en dusuk maliyet.
//
// Depo MOCK ile secilir (Node servisleriyle ayni kural): MOCK=true ise
// kayitlar BELLEKTE tutulur ve Mongo'ya HIC dokunulmaz (surec kapaninca
// hesaplar kaybolur); aksi halde Mongo'ya baglanilir ve indeksler kurulur.
func buildAuth(ctx context.Context, cfg config.Config, passwordCost int) (authParts, error) {
	passwords, err := auth.NewPasswordHasher(passwordCost)
	if err != nil {
		return authParts{}, err
	}
	tokens := auth.NewTokens(cfg.JWTSecret.Bytes(), cfg.JWTTTL, time.Now)
	// IP'den konum cozucu yok (GeoIP bekleyen is): oturum konumu kullanicinin
	// son bilinen konumundan gelir (auth.Locator).
	deps := auth.Deps{Passwords: passwords, Tokens: tokens, Locator: auth.NoLocator{}, RefreshTTL: cfg.RefreshTTL, Now: time.Now}
	parts := authParts{tokens: tokens, close: func(context.Context) error { return nil }}

	if cfg.Mock {
		users := authstore.NewMemoryUsers()
		loaded, err := preloadPersonas(ctx, cfg.NodeEnv, users, passwords)
		if err != nil {
			return authParts{}, err
		}
		deps.Users, deps.Sessions = users, authstore.NewMemorySessions()
		parts.service = auth.NewService(deps)
		parts.personas = loaded
		return parts, nil
	}

	client, err := mongodb.Connect(ctx, mongodb.Options{
		URI:                    cfg.MongoURI,
		ServerSelectionTimeout: cfg.MongoServerSelectionTimeout,
		OperationTimeout:       cfg.RequestTimeout,
	})
	if err != nil {
		return authParts{}, err
	}
	db := client.Database(cfg.MongoDB)
	if err := authstore.EnsureIndexes(ctx, db); err != nil {
		if disconnectErr := client.Disconnect(ctx); disconnectErr != nil {
			return authParts{}, fmt.Errorf("%w (kapatma: %w)", err, disconnectErr)
		}
		return authParts{}, err
	}
	deps.Users, deps.Sessions = authstore.NewMongoUsers(db), authstore.NewMongoSessions(db)
	parts.service = auth.NewService(deps)
	parts.pingers = map[string]health.Pinger{mongoHealthName: mongodb.NewPinger(client)}
	parts.close = client.Disconnect
	return parts, nil
}

// preloadPersonas, MOCK'ta demo personalarini bellege yukler: Mongo yoktur,
// seed komutu calismaz. Production'da yuklemez (persona.Allowed): bilinen
// sifreli hesap yalnizca yerelde. Demo sifresinin ozeti bir kez uretilir.
func preloadPersonas(ctx context.Context, nodeEnv string, users *authstore.MemoryUsers, passwords *auth.PasswordHasher) (int, error) {
	if persona.Allowed(nodeEnv) != nil {
		return 0, nil
	}
	set, err := persona.Load()
	if err != nil {
		return 0, err
	}
	passwordHash, err := passwords.Hash(set.Password)
	if err != nil {
		return 0, err
	}
	for _, user := range set.Users(time.Now(), passwordHash) {
		if err := users.Create(ctx, user); err != nil {
			return 0, fmt.Errorf("persona yuklenemedi (%s): %w", user.ID, err)
		}
	}
	return len(set.Accounts), nil
}
