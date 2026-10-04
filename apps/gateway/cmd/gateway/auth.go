package main

import (
	"context"
	"fmt"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/persona"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
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
	// favorites, favori marketlerin deposu (T11.13): kullanici kaydiyla ayni
	// yerde (MOCK'ta bellek, aksi halde users koleksiyonu).
	favorites favorites.Store
	// accounts, e-posta dogrulamasinin kullanici tarafi (T11.14): kullanici
	// deposunun kendisi (adres kullanici belgesinde).
	accounts emailverify.Accounts
	// phoneAccounts, sessions ve passwords: telefon degistirmenin kullanici,
	// oturum ve sifre tarafi (T11.14 PR 3).
	phoneAccounts phoneverify.Accounts
	sessions      phoneverify.Sessions
	passwords     *auth.PasswordHasher
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
	parts := authParts{tokens: tokens, passwords: passwords, close: func(context.Context) error { return nil }}

	if cfg.Mock {
		users := authstore.NewMemoryUsers()
		loaded, err := preloadPersonas(ctx, cfg.NodeEnv, users, passwords)
		if err != nil {
			return authParts{}, err
		}
		sessions := authstore.NewMemorySessions()
		deps.Users, deps.Sessions = users, sessions
		parts.service = auth.NewService(deps)
		parts.favorites = authstore.NewMemoryFavorites()
		parts.accounts, parts.phoneAccounts, parts.sessions = users, users, sessions
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
	users, sessions := authstore.NewMongoUsers(db), authstore.NewMongoSessions(db)
	deps.Users, deps.Sessions = users, sessions
	parts.service = auth.NewService(deps)
	parts.favorites = authstore.NewMongoFavorites(db)
	parts.accounts, parts.phoneAccounts, parts.sessions = users, users, sessions
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
