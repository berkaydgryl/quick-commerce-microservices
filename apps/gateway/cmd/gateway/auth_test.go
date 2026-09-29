package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
)

func authConfig(mock bool, mongoURI string) config.Config {
	return config.Config{
		Mock:                        mock,
		MongoURI:                    mongoURI,
		MongoDB:                     "getir",
		MongoServerSelectionTimeout: 200 * time.Millisecond,
		RequestTimeout:              time.Second,
		JWTSecret:                   config.Secret("yalnizca-test-icin-imza-sirri-32-bayttan-uzun"),
		JWTTTL:                      time.Hour,
		RefreshTTL:                  14 * 24 * time.Hour,
	}
}

func TestBuildAuthInMockModeUsesMemoryAndSkipsMongo(t *testing.T) {
	// MOCK'ta Mongo adresi verilmis olsa bile ona HIC gidilmez (Node
	// servisleriyle ayni kural); /healthz'de de mongo gorunmez.
	parts, err := buildAuth(t.Context(), authConfig(true, "mongodb://127.0.0.1:1"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("MOCK'ta kurulum Mongo'suz basarmali: %v", err)
	}
	if len(parts.pingers) != 0 {
		t.Errorf("MOCK'ta saglik raporuna Mongo eklenmemeli: %v", parts.pingers)
	}
	if err := parts.close(t.Context()); err != nil {
		t.Errorf("MOCK'ta kapatma bir sey yapmamali: %v", err)
	}

	grant, err := parts.service.Register(context.Background(),
		auth.RegisterInput{Phone: "+905321234567", Password: "Gizli-Parola-2026", FullName: "Ayse Yilmaz"}, auth.RequestMeta{})
	if err != nil {
		t.Fatalf("bellek deposuyla kayit basarmali: %v", err)
	}
	if identity, err := parts.tokens.Verify(grant.AccessToken); err != nil || identity.UserID != grant.User.ID {
		t.Errorf("servisin urettigi jeton ayni dogrulayicidan gecmeli: %+v %v", identity, err)
	}
}

func TestBuildAuthFailsFastWhenMongoIsUnreachable(t *testing.T) {
	// Mongo kapaliyken gateway "ayakta" gorunmemeli: hata acilista gelir.
	startedAt := time.Now()

	_, err := buildAuth(t.Context(), authConfig(false, "mongodb://127.0.0.1:1/?directConnection=true"), bcrypt.MinCost)

	if err == nil || !strings.Contains(err.Error(), "mongo'ya ulasilamadi") {
		t.Fatalf("ulasilamayan Mongo acilis hatasi vermeli: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 3*time.Second {
		t.Errorf("sunucu secim suresi uygulanmali, %v surdu", elapsed)
	}
}
