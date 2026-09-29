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
	deps := auth.Deps{Passwords: passwords, Tokens: tokens, RefreshTTL: cfg.RefreshTTL, Now: time.Now}
	parts := authParts{tokens: tokens, close: func(context.Context) error { return nil }}

	if cfg.Mock {
		deps.Users, deps.Sessions = authstore.NewMemoryUsers(), authstore.NewMemorySessions()
		parts.service = auth.NewService(deps)
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
