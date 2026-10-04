package emailverify

import (
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

func TestSendInputNormalizesAddress(t *testing.T) {
	input := SendInput{Email: "  Ayse.Yilmaz@Ornek.COM "}

	if problems := input.Check(); len(problems) != 0 {
		t.Fatalf("gecerli adres: %v", problems)
	}
	if input.Email != "ayse.yilmaz@ornek.com" {
		t.Errorf("kirpilip kucuk harfe cevrilmeli: %q", input.Email)
	}
}

func TestSendInputRejectsMalformedAddresses(t *testing.T) {
	// Sozlesmenin testindeki (email.spec.ts) bicimsiz adreslerin aynisi; ek
	// olarak RE2'nin \s'inin gormedigi Unicode bosluk.
	for _, email := range []string{"ayse", "ayse@", "@ornek.com", "ayse@ornek", "ay se@ornek.com", "a@b@ornek.com", "", "ay se@ornek.com"} {
		input := SendInput{Email: email}
		if problems := input.Check(); problems[FieldEmail] != emailReason {
			t.Errorf("%q reddedilmeli: %v", email, problems)
		}
	}
}

func TestSendInputLengthLimit(t *testing.T) {
	const domain = "@ornek.com"
	limit := strings.Repeat("a", emailMaxLength-len(domain)) + domain

	if problems := (&SendInput{Email: limit}).Check(); len(problems) != 0 {
		t.Errorf("%d karakter kabul edilmeli: %v", emailMaxLength, problems)
	}
	if problems := (&SendInput{Email: "a" + limit}).Check(); problems[FieldEmail] != emailMaxReason {
		t.Errorf("fazlasi reddedilmeli: %v", problems)
	}
}

func TestVerifyInputCollectsBothProblems(t *testing.T) {
	for _, code := range []string{"12345", "1234567", "12a456", " 123456", ""} {
		input := VerifyInput{Email: "ayse", Code: code}
		problems := input.Check()
		if problems[FieldEmail] != emailReason || problems[verification.FieldCode] != verification.CodeReason {
			t.Errorf("kod %q: iki alan birden bildirilmeli: %v", code, problems)
		}
	}
}

func TestCodeMessageEscapesNameInHTML(t *testing.T) {
	msg, err := codeMessage("ayse@ornek.com", "<b>Ayşe</b>", "042137")
	if err != nil {
		t.Fatalf("ileti kurulamadi: %v", err)
	}

	if strings.Contains(msg.HTML, "<b>Ayşe</b>") || !strings.Contains(msg.HTML, "&lt;b&gt;Ayşe&lt;/b&gt;") {
		t.Error("ad HTML'de kacislanmali")
	}
	if !strings.Contains(msg.Text, "042137") || !strings.Contains(msg.Text, "10 dakika") {
		t.Errorf("duz metin kodu ve sureyi soylemeli: %q", msg.Text)
	}
	if msg.Subject != codeSubject || msg.To != "ayse@ornek.com" {
		t.Errorf("konu ve alici: %+v", msg)
	}
}
