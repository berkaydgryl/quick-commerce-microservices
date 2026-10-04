package verification

import (
	"context"
	"time"
)

// Pending, bekleyen dogrulama: adres (e-posta ya da numara) ve kodun ozeti
// (kodun kendisi saklanmaz).
type Pending struct {
	Address  string
	CodeHash string
}

// Result, bir dogrulama denemesinin sonucu.
type Result int

// Sonuclar.
const (
	// ResultVerified, kod dogru: bekleyen kayit silindi.
	ResultVerified Result = iota + 1
	// ResultWrong, kod yanlis; Outcome.AttemptsLeft hak kaldi.
	ResultWrong
	// ResultLocked, MaxAttempts yanlis: kod iptal edildi. Yeni kod yine
	// ResendAfter beklemesine tabidir (iptal beklemeyi sifirlamaz).
	ResultLocked
	// ResultExpired, bekleyen kod yok: suresi doldu, hic istenmedi ya da
	// baska bir adrese istendi.
	ResultExpired
)

// Outcome, Check'in cevabi.
type Outcome struct {
	Result       Result
	AttemptsLeft int
}

// Store, bekleyen dogrulamalarin deposu: kullanici basina EN FAZLA BIR kayit.
// Arayuz KULLANAN tarafta; gercegi Redis (redis.go) ve bellek (memory.go),
// ikisi ayni sozlesmeden gecer (store_contract_test.go).
type Store interface {
	// Start, yeni kodu yazar: oncekinin yerine gecer, deneme sayaci sifirlanir,
	// omur ttl'den baslar. Son gonderimden resendAfter gecmediyse HICBIR SEY
	// yazmaz ve kalan beklemeyi doner (> 0). Tek atomik adimdir: es zamanli iki
	// istekten yalnizca biri kod yazar.
	Start(ctx context.Context, userID string, pending Pending, ttl, resendAfter time.Duration) (time.Duration, error)
	// Check, kodu dener. Adres bekleyenle ayni ve ozet esitse kayit silinir
	// (ResultVerified). Yanlis deneme sayilir; maxAttempts'e ulasinca kod iptal
	// olur ama gonderim ani kalir (yeni kod beklemesi surer). Tek atomik adim:
	// es zamanli denemeler hakki asamaz.
	Check(ctx context.Context, userID string, pending Pending, maxAttempts int) (Outcome, error)
	// Discard, ozeti verilen kodu siler (ileti gonderilemedi: kullanici
	// beklemeden yeniden isteyebilsin). Daha yeni bir koda dokunmaz.
	Discard(ctx context.Context, userID, codeHash string) error
	// PendingAddress, bekleyen kaydin adresi (kod kilitli olsa da); kayit yoksa
	// ya da omru dolduysa "". Telefonun yeniden gonderimi icin (T11.14 PR 3):
	// sifre bu adrese ilk kod istenirken soruldu, kayit yasadikca yeniden
	// sorulmaz.
	PendingAddress(ctx context.Context, userID string) (string, error)
}
