package emailverify

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
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
	Store    Store
	Mailer   Mailer
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
	store    Store
	mailer   Mailer
	hasher   codeHasher
	now      func() time.Time
	newCode  func() string
}

// NewService, servisi kurar.
func NewService(deps Deps) *Service {
	generate := deps.NewCode
	if generate == nil {
		generate = newCode
	}
	return &Service{
		accounts: deps.Accounts, store: deps.Store, mailer: deps.Mailer,
		hasher: codeHasher{key: deps.CodeKey}, now: deps.Now, newCode: generate,
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
	codeHash := s.hasher.hash(userID, input.Email, code)
	wait, err := s.store.Start(ctx, userID, Pending{Email: input.Email, CodeHash: codeHash}, CodeTTL, ResendAfter)
	if err != nil {
		return Sent{}, unavailable(err)
	}
	if wait > 0 {
		return Sent{}, tooSoon(wait)
	}

	if err := s.deliver(ctx, input.Email, user.FullName, code); err != nil {
		if discardErr := s.store.Discard(ctx, userID, codeHash); discardErr != nil {
			err = errors.Join(err, discardErr)
		}
		return Sent{}, unavailable(err)
	}
	return Sent{Email: input.Email, ExpiresInSeconds: int(CodeTTL.Seconds()), ResendAfterSeconds: int(ResendAfter.Seconds())}, nil
}

// Verify, kodu dogrular ve adresi hesaba yazar; guncel profili doner. Girdi
// dogrulanmis gelir (VerifyInput.Check). Kod dogru olsa bile adres bu arada
// baska hesapta dogrulanmissa VALIDATION_FAILED (email): karar benzersiz
// indekstedir.
func (s *Service) Verify(ctx context.Context, userID string, input VerifyInput) (auth.Profile, error) {
	pending := Pending{Email: input.Email, CodeHash: s.hasher.hash(userID, input.Email, input.Code)}
	outcome, err := s.store.Check(ctx, userID, pending, MaxAttempts)
	if err != nil {
		return auth.Profile{}, unavailable(err)
	}
	switch outcome.Result {
	case ResultVerified:
	case ResultWrong:
		return auth.Profile{}, rejectCode(fmt.Sprintf(codeWrongFormat, outcome.AttemptsLeft))
	case ResultLocked:
		return auth.Profile{}, rejectCode(codeLockedReason)
	default:
		return auth.Profile{}, rejectCode(codeExpiredReason)
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

// rejectEmail ve rejectCode, alanin altinda gosterilen kural ihlalleri.
func rejectEmail(reason string) error {
	return apperror.New(apperror.CodeValidationFailed, map[string]string{FieldEmail: reason})
}

func rejectCode(reason string) error {
	return apperror.New(apperror.CodeValidationFailed, map[string]string{FieldCode: reason})
}

// tooSoon, yeni kod icin bekleme bitmedi: 429 RATE_LIMITED ve tam saniyeye
// YUKARI yuvarlanmis bekleme (hiz siniriyla ayni bicim; httpapi Retry-After
// basligini buradan yazar).
func tooSoon(wait time.Duration) error {
	seconds := int(math.Ceil(wait.Seconds()))
	return &apperror.Error{Code: apperror.CodeRateLimited, Details: map[string]any{apperror.RetryAfterDetail: max(seconds, 1)}}
}

// unavailable, depo ya da posta sunucusu cevap vermedi: istemci tekrar dener.
func unavailable(err error) error {
	return &apperror.Error{Code: apperror.CodeServiceUnavailable, Cause: err}
}
