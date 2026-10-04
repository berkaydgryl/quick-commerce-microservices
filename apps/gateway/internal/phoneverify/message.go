package phoneverify

import (
	"fmt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// codeText, SMS'in metni: kisa, tek satir; kod ve gecerlilik.
func codeText(code string) string {
	return fmt.Sprintf("getir doğrulama kodun: %s. Kod %d dakika geçerli, kimseyle paylaşma.",
		code, int(verification.CodeTTL.Minutes()))
}
