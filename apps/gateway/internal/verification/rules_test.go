package verification

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

func TestValidCode(t *testing.T) {
	if !ValidCode("042137") {
		t.Error("6 rakam gecerli")
	}
	for _, code := range []string{"12345", "1234567", "12a456", " 123456", ""} {
		if ValidCode(code) {
			t.Errorf("%q gecersiz olmali", code)
		}
	}
}

func TestRejectionSentences(t *testing.T) {
	for outcome, want := range map[Outcome]string{
		{Result: ResultWrong, AttemptsLeft: 3}: "Kod hatalı. 3 deneme hakkın kaldı.",
		{Result: ResultLocked}:                 codeLockedReason,
		{Result: ResultExpired}:                codeExpiredReason,
	} {
		appErr := testkit.AppErrorOf(t, Rejection(outcome))
		if appErr.Code != apperror.CodeValidationFailed || appErr.Details[FieldCode] != want {
			t.Errorf("%+v: %+v", outcome, appErr)
		}
	}
	if err := Rejection(Outcome{Result: ResultVerified}); err != nil {
		t.Errorf("dogru kod hata degil: %v", err)
	}
}

func TestTooSoonRoundsUp(t *testing.T) {
	appErr := testkit.AppErrorOf(t, TooSoon(39*time.Second+300*time.Millisecond))
	if appErr.Code != apperror.CodeRateLimited || appErr.Details[apperror.RetryAfterDetail] != 40 ||
		apperror.HTTPStatus(appErr.Code) != http.StatusTooManyRequests {
		t.Errorf("429 ve 40 sn bekleniyordu: %+v", appErr)
	}
	if testkit.AppErrorOf(t, TooSoon(10*time.Millisecond)).Details[apperror.RetryAfterDetail] != 1 {
		t.Error("en az 1 saniye")
	}
}

func TestCodeHashDependsOnUserAddressCodeAndKey(t *testing.T) {
	hasher := NewHasher([]byte("anahtar"))
	base := hasher.Hash("usr_a", "ayse@ornek.com", "042137")

	for _, other := range []string{
		hasher.Hash("usr_b", "ayse@ornek.com", "042137"),
		hasher.Hash("usr_a", "+905321234567", "042137"),
		hasher.Hash("usr_a", "ayse@ornek.com", "042138"),
		NewHasher([]byte("baska")).Hash("usr_a", "ayse@ornek.com", "042137"),
	} {
		if other == base {
			t.Error("ozet kullanici, adres, kod ve anahtardan birinin degisiminde degismeli")
		}
	}
	if strings.Contains(base, "042137") {
		t.Error("ozet kodu acik tasimamali")
	}
}

func TestNewCodeIsSixDigits(t *testing.T) {
	for range 200 {
		if code := NewCode(); !ValidCode(code) {
			t.Fatalf("6 rakam bekleniyordu: %q", code)
		}
	}
}

func TestKeyPerChannel(t *testing.T) {
	if Key(ChannelEmail, "usr_7") != "verify:email:{usr_7}" || Key(ChannelPhone, "usr_7") != "verify:phone:{usr_7}" {
		t.Errorf("anahtarlar: %q %q", Key(ChannelEmail, "usr_7"), Key(ChannelPhone, "usr_7"))
	}
}
