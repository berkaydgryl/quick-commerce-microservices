package phoneverify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// Accounts, kullanici kayitlarinin telefon tarafi; gercegi authstore
// (MongoUsers, MemoryUsers).
type Accounts interface {
	// ByID, kimlige gore kullanici; yoksa auth.ErrUserNotFound.
	ByID(ctx context.Context, id string) (auth.User, error)
	// ByPhone, numaraya gore kullanici; yoksa auth.ErrUserNotFound.
	ByPhone(ctx context.Context, phone string) (auth.User, error)
	// SetVerifiedPhone, dogrulanan numarayi yazar; numara baska hesaptaysa
	// auth.ErrPhoneTaken, kullanici yoksa auth.ErrUserNotFound.
	SetVerifiedPhone(ctx context.Context, userID, phone string, verifiedAt time.Time) error
}

// Sessions, oturumlar: numara degisince bu oturum disindakiler kapanir.
type Sessions interface {
	RevokeOthers(ctx context.Context, userID, keepSessionID string) (int, error)
}

// Passwords, sifre karsilastirmasi (gercegi auth.PasswordHasher).
type Passwords interface {
	Matches(hash, password string) (bool, error)
}

// SMS, mesaji numaraya gonderir (gercegi sms.Mailbox; gercek saglayici #95).
type SMS interface {
	Send(ctx context.Context, phone, text string) error
}

// Deps, servisin disaridan aldigi her sey.
type Deps struct {
	Accounts  Accounts
	Sessions  Sessions
	Passwords Passwords
	// Store, bekleyen telefon kodlarinin deposu (verification, kanal telefon).
	Store verification.Store
	SMS   SMS
	// CodeKey, kod ozetinin HMAC anahtari (cmd/gateway sirdan turetir).
	CodeKey []byte
	Now     func() time.Time
	// NewCode, kod uretici; nil ise kriptografik rastgele 6 rakam.
	NewCode func() string
}

// Sent, POST /v1/me/phone/code cevabi (@getir/contracts phoneCodeSentSchema).
type Sent struct {
	Phone              string `json:"phone"`
	ExpiresInSeconds   int    `json:"expiresInSeconds"`
	ResendAfterSeconds int    `json:"resendAfterSeconds"`
}

// Service, telefon dogrulamasinin is kurali.
type Service struct {
	deps    Deps
	hasher  verification.Hasher
	newCode func() string
}

// NewService, servisi kurar.
func NewService(deps Deps) *Service {
	generate := deps.NewCode
	if generate == nil {
		generate = verification.NewCode
	}
	return &Service{deps: deps, hasher: verification.NewHasher(deps.CodeKey), newCode: generate}
}

// SendCode, numaraya yeni kod gonderir. Girdi bicimce dogrulanmis gelir.
//
// Sira: numara simdikiyse (dogrulama) sifre sorulmaz, zaten dogrulanmissa ret;
// baska numaraysa once sifre (o numaraya bekleyen kod varken yeniden gonderim
// sifresizdir), sonra numaranin baska hesapta olup olmadigi;
// sonra depoda atomik "bekleme bitti mi + yaz", en son SMS. SMS gidemezse kod
// silinir: kullanici 60 saniye beklemeden yeniden deneyebilir.
func (s *Service) SendCode(ctx context.Context, userID string, input SendInput) (Sent, error) {
	user, err := s.account(ctx, userID)
	if err != nil {
		return Sent{}, err
	}
	if err := s.permit(ctx, user, input); err != nil {
		return Sent{}, err
	}

	code := s.newCode()
	codeHash := s.hasher.Hash(userID, input.Phone, code)
	pending := verification.Pending{Address: input.Phone, CodeHash: codeHash}
	wait, err := s.deps.Store.Start(ctx, userID, pending, verification.CodeTTL, verification.ResendAfter)
	if err != nil {
		return Sent{}, verification.Unavailable(err)
	}
	if wait > 0 {
		return Sent{}, verification.TooSoon(wait)
	}

	if err := s.deps.SMS.Send(ctx, input.Phone, codeText(code)); err != nil {
		if discardErr := s.deps.Store.Discard(ctx, userID, codeHash); discardErr != nil {
			err = errors.Join(err, discardErr)
		}
		return Sent{}, verification.Unavailable(fmt.Errorf("dogrulama SMS'i gonderilemedi: %w", err))
	}
	return Sent{
		Phone:              input.Phone,
		ExpiresInSeconds:   int(verification.CodeTTL.Seconds()),
		ResendAfterSeconds: int(verification.ResendAfter.Seconds()),
	}, nil
}

// permit, kod istegine izin verir mi: simdiki numara (dogrulanmamissa) ya da
// kimsede olmayan baska bir numara. Baska numarada sifre sorulur; yalnizca
// sifresiz YENIDEN GONDERIM (o numaraya bekleyen kayit varken) sormaz: sifre
// o kayit baslarken soruldu, kayit en fazla CodeTTL yasar. Sifre gelirse her
// zaman denetlenir.
func (s *Service) permit(ctx context.Context, user auth.User, input SendInput) error {
	if input.Phone == user.Phone {
		if !user.PhoneVerifiedAt.IsZero() {
			return reject(FieldPhone, phoneCurrentReason)
		}
		return nil
	}
	if err := s.checkPassword(ctx, user, input); err != nil {
		return err
	}
	owner, err := s.deps.Accounts.ByPhone(ctx, input.Phone)
	switch {
	case errors.Is(err, auth.ErrUserNotFound):
		return nil
	case err != nil:
		return fmt.Errorf("numaranin sahibi okunamadi: %w", err)
	case owner.ID != user.ID:
		return phoneTaken()
	}
	return nil
}

// checkPassword, baska numaraya kod isteginin sifresi: bos sifre yalnizca o
// numaraya bekleyen kayit varken (yeniden gonderim) gecer.
func (s *Service) checkPassword(ctx context.Context, user auth.User, input SendInput) error {
	if input.Password == "" {
		pending, err := s.deps.Store.PendingAddress(ctx, user.ID)
		if err != nil {
			return verification.Unavailable(err)
		}
		if pending != input.Phone {
			return reject(FieldPassword, passwordRequiredReason)
		}
		return nil
	}
	matches, err := s.deps.Passwords.Matches(user.PasswordHash, input.Password)
	if err != nil {
		return err
	}
	if !matches {
		return reject(FieldPassword, passwordWrongReason)
	}
	return nil
}

// Verify, kodu dogrular, numarayi hesaba yazar ve guncel profili doner. Numara
// DEGISTIYSE bu oturum (identity.SessionID) disindaki butun oturumlar kapanir:
// diger cihazlar eski kimlikle acik kalmasin. Numara bu arada baska hesaba
// gectiyse PHONE_ALREADY_REGISTERED (benzersiz indeks).
func (s *Service) Verify(ctx context.Context, identity auth.Identity, input VerifyInput) (auth.Profile, error) {
	pending := verification.Pending{Address: input.Phone, CodeHash: s.hasher.Hash(identity.UserID, input.Phone, input.Code)}
	outcome, err := s.deps.Store.Check(ctx, identity.UserID, pending, verification.MaxAttempts)
	if err != nil {
		return auth.Profile{}, verification.Unavailable(err)
	}
	if err := verification.Rejection(outcome); err != nil {
		return auth.Profile{}, err
	}

	before, err := s.account(ctx, identity.UserID)
	if err != nil {
		return auth.Profile{}, err
	}
	err = s.deps.Accounts.SetVerifiedPhone(ctx, identity.UserID, input.Phone, s.deps.Now().UTC())
	switch {
	case errors.Is(err, auth.ErrPhoneTaken):
		return auth.Profile{}, phoneTaken()
	case errors.Is(err, auth.ErrUserNotFound):
		return auth.Profile{}, apperror.New(apperror.CodeUnauthorized, nil)
	case err != nil:
		return auth.Profile{}, fmt.Errorf("numara yazilamadi: %w", err)
	}
	if before.Phone != input.Phone {
		if _, err := s.deps.Sessions.RevokeOthers(ctx, identity.UserID, identity.SessionID); err != nil {
			return auth.Profile{}, fmt.Errorf("diger oturumlar kapatilamadi: %w", err)
		}
	}
	after, err := s.account(ctx, identity.UserID)
	if err != nil {
		return auth.Profile{}, err
	}
	return after.Profile(), nil
}

// account, oturumdaki kullanici. Silinmisse UNAUTHORIZED.
func (s *Service) account(ctx context.Context, userID string) (auth.User, error) {
	user, err := s.deps.Accounts.ByID(ctx, userID)
	if errors.Is(err, auth.ErrUserNotFound) {
		return auth.User{}, apperror.New(apperror.CodeUnauthorized, nil)
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	return user, nil
}

// reject, alanin altinda gosterilen kural ihlali (VALIDATION_FAILED).
func reject(field, reason string) error {
	return apperror.New(apperror.CodeValidationFailed, map[string]string{field: reason})
}

// phoneTaken, numara baska hesapta: kayittaki kodla ayni (PHONE_ALREADY_REGISTERED,
// 409); cumle alanin altinda gosterilir.
func phoneTaken() error {
	return apperror.New(apperror.CodePhoneAlreadyRegistered, map[string]string{FieldPhone: phoneTakenReason})
}
