package httpapi

// Kart kasasi uclari (T11.17): GET ve POST /v1/me/cards, DELETE
// /v1/me/cards/{cardId}. Kasa payment-svc'dedir (CardVaultService). Ayri
// dosyadadir: routes.go (registerMeRoutes) yalnizca registerCardRoutes'u
// cagirir (dosya boyutu kurali).
//
// Kart numarasi ve CVV yalnizca POST govdesinde gecer; gateway onlari kasaya
// iletir ve hicbir yere yazmaz: istek satiri yalnizca yontem, yol ve durum
// tasir, tekrar korumasi kaydi maskeli parmak izi tasir (K3). Kullanici YALNIZCA
// erisim jetonundan gelir (QA G6): govde ve sorgu kullanici alani tasimaz,
// bilinmeyen alan 400'dur. Cevaplar onbelleklenmez (QA G7: no-store, hata
// cevaplari dahil).

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/cards"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// cardIDParam, kart yolundaki kimlik: /v1/me/cards/{cardId}.
const cardIDParam = "cardId"

// CardLister, GET /v1/me/cards.
type CardLister interface {
	ListCards(ctx context.Context, userID string) (cards.SavedCardList, error)
}

// CardAdder, POST /v1/me/cards.
type CardAdder interface {
	AddCard(ctx context.Context, userID string, input cards.AddInput) (cards.SavedCard, error)
}

// CardDeleter, DELETE /v1/me/cards/{cardId}.
type CardDeleter interface {
	DeleteCard(ctx context.Context, userID, cardID string) (cards.SavedCardList, error)
}

// CardRoutes, kart uclarinin bagimliliklari. Biri nil ise uclar HIC baglanmaz
// (production, K1: saglayici bugun mock'tur); bugun ucunu cards.Service karsilar.
type CardRoutes struct {
	Lister  CardLister
	Adder   CardAdder
	Deleter CardDeleter
	// Failures, basarisiz dogrulama sayaci (K2). nil ise kullanici siniri kapali
	// (hiz siniri kapaliyken, RATE_LIMIT_ENABLED=false).
	Failures ratelimit.FailureCounter
	// Inflight, kullanici basina tek kart dogrulamasi (guvenlik incelemesi): es
	// zamanli istekler sayaci asamasin. Failures ile ayni depo; nil ise kapali.
	Inflight ratelimit.InflightLock
}

// cardAddPolicy, kart eklemenin tekrar kurali (K3): cevap tekrar edilir, parmak
// izi maskeli govdeden, kayit kisa omurlu.
var cardAddPolicy = idempotencyPolicy{replay: true, fingerprintBody: cards.FingerprintBody, ttl: cards.IdempotencyTTL}

// cardDeletePolicy, kart silmenin tekrar kurali (QA L3): saklanan cevap maskeli
// kart listesidir (ad, ilk 4, son 4); kayit eklemeyle ayni kisa omurlu.
var cardDeletePolicy = idempotencyPolicy{replay: true, ttl: cards.IdempotencyTTL}

// cardRouteDeps, kart rotalarinin yonlendiriciden aldigi ara katmanlar.
type cardRouteDeps struct {
	user, general fiber.Handler
	idempotency   Idempotency
	limits        rateLimiter
	logger        *slog.Logger
	recorder      RequestMetrics
}

// registerCardRoutes, kart uclarini baglar; uclar kapaliysa hicbir sey yapmaz.
func registerCardRoutes(v1 fiber.Router, routes CardRoutes, deps cardRouteDeps) {
	if routes.Lister == nil || routes.Adder == nil || routes.Deleter == nil {
		return
	}
	attempts := cardAttempts{
		failures: routes.Failures,
		inflight: routes.Inflight,
		limiter:  deps.limits.settings.Limiter,
		warning:  deps.limits.warning,
		recorder: deps.recorder,
	}
	add := idempotent(deps.idempotency, cardAddPolicy, deps.logger, deps.recorder)
	remove := idempotent(deps.idempotency, cardDeletePolicy, deps.logger, deps.recorder)
	v1.Get("/me/cards", noStoreCards, deps.user, deps.general, listCardsHandler(routes.Lister))
	// Sira: deneme siniri (bakma, IP) -> tekrar korumasi (tekrar istek kasaya
	// gitmez) -> tek dogrulama kilidi -> uc (sonucu sayaca yazar, sonra kilit birakilir).
	v1.Post("/me/cards", noStoreCards, deps.user, deps.general, attempts.admit, add, attempts.single, addCardHandler(routes.Adder, attempts))
	v1.Delete("/me/cards/:"+cardIDParam, noStoreCards, deps.user, deps.general, remove, deleteCardHandler(routes.Deleter))
}

// noStoreCards, kart uclarinin HER cevabina (hata dahil) no-store yazar (QA G7).
func noStoreCards(c fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, noStore)
	return c.Next()
}

// addCardBody, POST /v1/me/cards govdesi (@getir/contracts addCardRequestSchema).
// Gateway yalnizca BICIMI denetler (tip, bilinmeyen alan); kart kurallari ve
// cumleleri kasadadir. Eksik alan sifir degerle gider, kasa kendi cumlesiyle reddeder.
type addCardBody struct {
	Number      string `json:"number"`
	ExpiryMonth int32  `json:"expiryMonth"`
	ExpiryYear  int32  `json:"expiryYear"`
	CVV         string `json:"cvv"`
	HolderName  string `json:"holderName"`
	Nickname    string `json:"nickname"`
}

func (b addCardBody) toInput() cards.AddInput {
	return cards.AddInput{
		Number:      b.Number,
		ExpiryMonth: b.ExpiryMonth,
		ExpiryYear:  b.ExpiryYear,
		CVV:         b.CVV,
		HolderName:  b.HolderName,
		Nickname:    b.Nickname,
	}
}

// listCardsHandler, GET /v1/me/cards: kullanicinin kartlari, yeniden eskiye.
func listCardsHandler(lister CardLister) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		list, err := lister.ListCards(outgoingContext(c), userIDOf(c))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, list)
	}
}

// addCardHandler, POST /v1/me/cards: kart dogrulanir ve kaydedilir (201,
// maskeli kart). Sonuc deneme sayacina ve metrige islenir (K2).
func addCardHandler(adder CardAdder, attempts cardAttempts) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body addCardBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		card, err := adder.AddCard(outgoingContext(c), userIDOf(c), body.toInput())
		attempts.observe(c, err)
		if err != nil {
			return err
		}
		return private(c, http.StatusCreated, card)
	}
}

// deleteCardHandler, DELETE /v1/me/cards/{cardId}: cevap guncel liste.
// Bicimsiz kimlik kasaya gitmeden 404 (QA G6); baskasinin, olmayan ya da
// silinmis kart da kasadan 404 doner, uc durum ayirt edilemez.
func deleteCardHandler(deleter CardDeleter) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}
		cardID := cardIDOf(c)
		if !ids.Valid(ids.Card, cardID) {
			return apperror.New(apperror.CodeNotFound, nil)
		}

		list, err := deleter.DeleteCard(outgoingContext(c), userIDOf(c), cardID)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, list)
	}
}

// cardIDOf, yol parametresinin KOPYASI (addressIDOf ile ayni gerekce, #87).
func cardIDOf(c fiber.Ctx) string {
	return strings.Clone(c.Params(cardIDParam))
}
