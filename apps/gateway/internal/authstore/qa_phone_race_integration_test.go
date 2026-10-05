//go:build integration

// QA kara kutu (T11.14 PR 3, #122; QA incelemesi 3): AYNI numarayi iki hesap
// ayni anda dogrular. HTTP uclari (httpapi.New) GERCEK Mongo depolariyla
// (Testcontainers, kendi konteyneri): tek kazanan 200, oteki 409
// PHONE_ALREADY_REGISTERED; numara tek hesapta, kaybedenin numarasi ve
// oturumu yerinde. Bellek deposu kilitle ayni sonucu verir; buradaki garanti
// users.phone benzersiz indeksinindir.
//
// Calistirma (Docker gerekir): go test -tags integration -run TestQA ./internal/authstore/
package authstore_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/testcontainers/testcontainers-go"
	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

const (
	qaRacePassword = "Gizli-Parola-2026"
	qaRaceCode     = "481516"
	qaRaceRounds   = 12
)

// qaRaceMongo, bu teste ozel Mongo konteyneri ve indeksleri kurulu veritabani.
func qaRaceMongo(t *testing.T) *mongo.Database {
	t.Helper()
	ctx := context.Background()
	container, err := tcmongo.Run(ctx, "mongo:7")
	if err != nil {
		t.Fatalf("mongo konteyneri: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Errorf("konteyner kapatilamadi: %v", err)
		}
	})
	uri, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("baglanti dizesi: %v", err)
	}
	mongoClient, err := mongodb.Connect(ctx, mongodb.Options{URI: uri, ServerSelectionTimeout: 10 * time.Second, OperationTimeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("mongo: %v", err)
	}
	t.Cleanup(func() {
		if err := mongoClient.Disconnect(context.Background()); err != nil {
			t.Errorf("mongo kapatilamadi: %v", err)
		}
	})
	db := mongoClient.Database("qa_telefon_" + ids.New("t"))
	if err := authstore.EnsureIndexes(ctx, db); err != nil {
		t.Fatalf("indeksler: %v", err)
	}
	return db
}

// qaRaceApp, kimlik ve telefon uclari Mongo depolariyla.
func qaRaceApp(t *testing.T, db *mongo.Database) *fiber.App {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici: %v", err)
	}
	users, sessions := authstore.NewMongoUsers(db), authstore.NewMongoSessions(db)
	tokens := auth.NewTokens([]byte("yalnizca-qa-testi-icin-imza-sirri-32-bayttan-uzun"), time.Hour, time.Now)
	identity := auth.NewService(auth.Deps{
		Users: users, Sessions: sessions, Passwords: passwords,
		Tokens: tokens, RefreshTTL: 14 * 24 * time.Hour, Now: time.Now,
	})
	phones := phoneverify.NewService(phoneverify.Deps{
		Accounts: users, Sessions: sessions, Passwords: passwords,
		Store: verification.NewMemory(time.Now), SMS: qaRaceSMS{},
		CodeKey: []byte("qa-telefon-anahtari"), Now: time.Now,
		NewCode: func() string { return qaRaceCode },
	})
	return httpapi.New(httpapi.Deps{
		UserRegistrar: identity, UserAuthenticator: identity, SessionRefresher: identity,
		ProfileGetter: identity, PhoneCodeSender: phones, PhoneVerifier: phones,
		AccessTokens: tokens,
		Idempotency: httpapi.Idempotency{
			Store: idempotency.NewMemory(time.Now), FingerprintKey: []byte("qa-parmak-izi"), TTL: time.Hour,
		},
		Logger: qaRaceLogger(),
	})
}

func qaRaceLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

type qaRaceSMS struct{}

func (qaRaceSMS) Send(context.Context, string, string) error { return nil }

// qaRaceCall, istegi gonderir; durum, hata kodu, veri ve yenileme cerezi.
func qaRaceCall(t *testing.T, app *fiber.App, method, path, access, refresh, body string) (int, apperror.Code, json.RawMessage, string) {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(httpapi.IdempotencyKeyHeader, "qa-"+ids.New("k"))
	if access != "" {
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+access)
	}
	if refresh != "" {
		request.AddCookie(&http.Cookie{Name: httpapi.RefreshCookie, Value: refresh})
	}
	response, err := app.Test(request, fiber.TestConfig{Timeout: 30 * time.Second})
	if err != nil {
		t.Errorf("istek basarisiz: %v", err)
		return 0, "", nil, ""
	}
	raw, readErr := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("govde kapatilamadi: %v", closeErr)
	}
	if readErr != nil {
		t.Errorf("govde okunamadi: %v", readErr)
		return response.StatusCode, "", nil, ""
	}
	var envelope struct {
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code apperror.Code `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Errorf("zarf cozulemedi: %v %s", err, raw)
	}
	code := apperror.Code("")
	if envelope.Error != nil {
		code = envelope.Error.Code
	}
	refreshToken := ""
	for _, line := range response.Header.Values(fiber.HeaderSetCookie) {
		if cookie, err := http.ParseSetCookie(line); err == nil && cookie.Name == httpapi.RefreshCookie {
			refreshToken = cookie.Value
		}
	}
	return response.StatusCode, code, envelope.Data, refreshToken
}

type qaRaceAccount struct {
	phone, access, refresh string
}

func qaRaceRegister(t *testing.T, app *fiber.App, phone string) qaRaceAccount {
	t.Helper()
	body := `{"phone":"` + phone + `","password":"` + qaRacePassword + `","fullName":"Yaris Hesabi"}`
	status, code, data, refresh := qaRaceCall(t, app, http.MethodPost, "/v1/auth/register", "", "", body)
	var grant auth.Grant
	if status != http.StatusCreated || json.Unmarshal(data, &grant) != nil {
		t.Fatalf("kayit %s: %d %s", phone, status, code)
	}
	return qaRaceAccount{phone: phone, access: grant.AccessToken, refresh: refresh}
}

func TestQAConcurrentVerificationsOfOnePhoneHaveOneWinner(t *testing.T) {
	db := qaRaceMongo(t)
	app := qaRaceApp(t, db)

	for round := range qaRaceRounds {
		suffix := strconv.Itoa(100 + round)
		first := qaRaceRegister(t, app, "+905321111"+suffix)
		second := qaRaceRegister(t, app, "+905321112"+suffix)
		contested := "+905551113" + suffix
		for _, account := range []qaRaceAccount{first, second} {
			body := `{"phone":"` + contested + `","password":"` + qaRacePassword + `"}`
			if status, code, _, _ := qaRaceCall(t, app, http.MethodPost, "/v1/me/phone/code", account.access, "", body); status != http.StatusAccepted {
				t.Fatalf("tur %d kod: %d %s", round, status, code)
			}
		}

		type outcome struct {
			status int
			code   apperror.Code
		}
		outcomes := make([]outcome, 2)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for index, account := range []qaRaceAccount{first, second} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				body := `{"phone":"` + contested + `","code":"` + qaRaceCode + `"}`
				status, code, _, _ := qaRaceCall(t, app, http.MethodPost, "/v1/me/phone/verify", account.access, "", body)
				outcomes[index] = outcome{status: status, code: code}
			}()
		}
		close(start)
		wg.Wait()

		winners, losers := 0, []qaRaceAccount{}
		for index, result := range outcomes {
			switch {
			case result.status == http.StatusOK:
				winners++
			case result.status == http.StatusConflict && result.code == apperror.CodePhoneAlreadyRegistered:
				losers = append(losers, []qaRaceAccount{first, second}[index])
			default:
				t.Errorf("tur %d: beklenmeyen sonuc %d %s", round, result.status, result.code)
			}
		}
		owners, err := db.Collection("users").CountDocuments(t.Context(), bson.M{"phone": contested})
		if err != nil {
			t.Fatalf("sayim: %v", err)
		}
		if winners != 1 || len(losers) != 1 || owners != 1 {
			t.Fatalf("tur %d: tek kazanan bekleniyordu: kazanan %d, kaybeden %d, numarali hesap %d", round, winners, len(losers), owners)
		}
		loser := losers[0]
		if status, _, data, _ := qaRaceCall(t, app, http.MethodGet, "/v1/me", loser.access, "", ""); status != http.StatusOK || !strings.Contains(string(data), loser.phone) {
			t.Errorf("tur %d: kaybedenin numarasi yerinde kalmali: %d %s", round, status, data)
		}
		if status, _, _, _ := qaRaceCall(t, app, http.MethodPost, "/v1/auth/refresh", "", loser.refresh, ""); status != http.StatusOK {
			t.Errorf("tur %d: kaybedenin oturumu surmeli: %d", round, status)
		}
	}
}
