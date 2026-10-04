package emailverify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// Accounts, kullanici kayitlarinin e-posta tarafi; gercegi authstore
// (MongoUsers, MemoryUsers). Adres kullanici belgesindedir: profil onu okur.
type Accounts interface {
	// ByID, kimlige gore kullanici; yoksa auth.ErrUserNotFound.
	ByID(ctx context.Context, id string) (auth.User, error)
	// EmailOwner, adresi dogrulanmis kullanicinin kimligi; kimsede yoksa "".
	EmailOwner(ctx context.Context, email string) (string, error)
	// SetVerifiedEmail, dogrulanmis adresi yazar; adres baska hesaptaysa
	// auth.ErrEmailTaken, kullanici yoksa auth.ErrUserNotFound.
	SetVerifiedEmail(ctx context.Context, userID, email string, verifiedAt time.Time) error
}

// Mailer, iletiyi teslim eder; gercegi mail.SMTP (MOCK'ta mail.Memory).
type Mailer interface {
	Send(ctx context.Context, msg mail.Message) error
}

// Deps, servisin disaridan aldigi her sey.
type Deps struct {
	Accounts Accounts
	// Store, bekleyen e-posta kodlarinin deposu (verification, kanal e-posta).
	Store  verification.Store
	Mailer Mailer
	// CodeKey, kod ozetinin HMAC anahtari (cmd/gateway sirdan turetir).
	CodeKey []byte
	Now     func() time.Time
	// NewCode, kod uretici; nil ise kriptografik rastgele 6 rakam. Testler
	// bilinen kod verir.
	NewCode func() string
}

// Sent, POST /v1/me/email/code cevabi (@getir/contracts emailCodeSentSchema).
type Sent struct {
	Email              string `json:"email"`
	ExpiresInSeconds   int    `json:"expiresInSeconds"`
	ResendAfterSeconds int    `json:"resendAfterSeconds"`
}

// Service, e-posta dogrulamasinin is kurali.
type Service struct {
	accounts Accounts
	store    verification.Store
	mailer   Mailer
	hasher   verification.Hasher
	now      func() time.Time
	newCode  func() string
}

// NewService, servisi kurar.
func NewService(deps Deps) *Service {
	generate := deps.NewCode
	if generate == nil {
		generate = verification.NewCode
	}
	return &Service{
		accounts: deps.Accounts, store: deps.Store, mailer: deps.Mailer,
		hasher: verification.NewHasher(deps.CodeKey), now: deps.Now, newCode: generate,
	}
}

// SendCode, adrese yeni kod gonderir. Girdi dogrulanmis gelir (SendInput.Check).
//
// Sira: once kurallar (adres zaten bu hesapta, baska hesapta), sonra depoda
// atomik "bekleme bitti mi + yaz", en son ileti. Ileti gonderilemezse kod
// silinir: kullanici 60 saniye beklemeden yeniden deneyebilir.
func (s *Service) SendCode(ctx context.Context, userID string, input SendInput) (Sent, error) {
	user, err := s.account(ctx, userID)
	if err != nil {
		return Sent{}, err
	}
	if user.Email == input.Email {
		return Sent{}, rejectEmail(emailCurrentReason)
	}
	owner, err := s.accounts.EmailOwner(ctx, input.Email)
	if err != nil {
		return Sent{}, fmt.Errorf("e-posta sahibi okunamadi: %w", err)
	}
	if owner != "" && owner != userID {
		return Sent{}, rejectEmail(emailTakenReason)
	}

	code := s.newCode()
	codeHash := s.hasher.Hash(userID, input.Email, code)
	pending := verification.Pending{Address: input.Email, CodeHash: codeHash}
	wait, err := s.store.Start(ctx, userID, pending, verification.CodeTTL, verification.ResendAfter)
	if err != nil {
		return Sent{}, verification.Unavailable(err)
	}
	if wait > 0 {
		return Sent{}, verification.TooSoon(wait)
	}

	if err := s.deliver(ctx, input.Email, user.FullName, code); err != nil {
		if discardErr := s.store.Discard(ctx, userID, codeHash); discardErr != nil {
			err = errors.Join(err, discardErr)
		}
		return Sent{}, verification.Unavailable(err)
	}
	return Sent{
		Email:              input.Email,
		ExpiresInSeconds:   int(verification.CodeTTL.Seconds()),
		ResendAfterSeconds: int(verification.ResendAfter.Seconds()),
	}, nil
}

// Verify, kodu dogrular ve adresi hesaba yazar; guncel profili doner. Girdi
// dogrulanmis gelir (VerifyInput.Check). Kod dogru olsa bile adres bu arada
// baska hesapta dogrulanmissa VALIDATION_FAILED (email): karar benzersiz
// indekstedir.
func (s *Service) Verify(ctx context.Context, userID string, input VerifyInput) (auth.Profile, error) {
	pending := verification.Pending{Address: input.Email, CodeHash: s.hasher.Hash(userID, input.Email, input.Code)}
	outcome, err := s.store.Check(ctx, userID, pending, verification.MaxAttempts)
	if err != nil {
		return auth.Profile{}, verification.Unavailable(err)
	}
	if err := verification.Rejection(outcome); err != nil {
		return auth.Profile{}, err
	}

	err = s.accounts.SetVerifiedEmail(ctx, userID, input.Email, s.now().UTC())
	switch {
	case errors.Is(err, auth.ErrEmailTaken):
		return auth.Profile{}, rejectEmail(emailTakenReason)
	case errors.Is(err, auth.ErrUserNotFound):
		return auth.Profile{}, apperror.New(apperror.CodeUnauthorized, nil)
	case err != nil:
		return auth.Profile{}, fmt.Errorf("e-posta yazilamadi: %w", err)
	}
	user, err := s.account(ctx, userID)
	if err != nil {
		return auth.Profile{}, err
	}
	return user.Profile(), nil
}

// account, oturumdaki kullanici. Silinmisse jeton artik bir hesaba karsilik
// gelmez: UNAUTHORIZED (auth.Service.Profile ile ayni kural).
func (s *Service) account(ctx context.Context, userID string) (auth.User, error) {
	user, err := s.accounts.ByID(ctx, userID)
	if errors.Is(err, auth.ErrUserNotFound) {
		return auth.User{}, apperror.New(apperror.CodeUnauthorized, nil)
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	return user, nil
}

// deliver, kodu iletiye koyup gonderir.
func (s *Service) deliver(ctx context.Context, to, fullName, code string) error {
	msg, err := codeMessage(to, fullName, code)
	if err != nil {
		return err
	}
	if err := s.mailer.Send(ctx, msg); err != nil {
		return fmt.Errorf("dogrulama iletisi gonderilemedi: %w", err)
	}
	return nil
}

// rejectEmail, adres alaninin altinda gosterilen kural ihlali.
func rejectEmail(reason string) error {
	return apperror.New(apperror.CodeValidationFailed, map[string]string{FieldEmail: reason})
}
