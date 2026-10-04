package roomtoken

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Diller arasi uyum (QA-RT-L1g, T12.2): gateway jetonu Go ile imzalar, realtime
// Node'da (jose) dogrular. Iki tarafin ayni jetonda bulustugunu canli yigin
// olmadan kanitlamak icin ALTIN jeton paylasilir:
//
//   - bu test, Signer'in sabit saat ve sirla urettigi jetonun altin dosyadakiyle
//     BIREBIR ayni oldugunu denetler (Go'nun bicimi degisirse burada kirilir);
//   - realtime-service/test/unit/qa-gateway-token.spec.ts ayni jetonu realtime'in
//     gercek dogrulayicisindan gecirir (Node reddederse orada kirilir).
//
// Dosya sozlesme paketinin test klasorundedir; okuma testkit.ReadContract'in
// goreli yol yontemiyle (go test paketin klasorunde calisir).
const goldenRoomTokenPath = "../../../../packages/contracts/test/fixtures/gateway-room-token.golden.json"

type goldenRoomToken struct {
	Secret     string `json:"secret"`
	UserID     string `json:"userId"`
	OrderID    string `json:"orderId"`
	SignedAt   string `json:"signedAt"`
	Token      string `json:"token"`
	Room       string `json:"room"`
	ExpiresAt  string `json:"expiresAt"`
	TTLSeconds int64  `json:"ttlSeconds"`
}

func readGoldenRoomToken(t *testing.T) goldenRoomToken {
	t.Helper()
	var golden goldenRoomToken
	if err := json.Unmarshal([]byte(testkit.ReadContract(t, goldenRoomTokenPath)), &golden); err != nil {
		t.Fatalf("altin jeton dosyasi okunamadi: %v", err)
	}
	return golden
}

func TestGoldenRoomTokenMatchesSigner(t *testing.T) {
	golden := readGoldenRoomToken(t)
	signedAt, err := time.Parse(time.RFC3339Nano, golden.SignedAt)
	if err != nil {
		t.Fatalf("signedAt bicim disi: %v", err)
	}

	token, err := NewSigner([]byte(golden.Secret), func() time.Time { return signedAt }).Sign(golden.UserID, golden.OrderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	if token.Token != golden.Token {
		t.Errorf("Signer'in jetonu altin jetondan farkli; Go bicimi degistiyse realtime'in kabul ettigini dogrulayip dosyayi guncelle:\n got %s\nwant %s", token.Token, golden.Token)
	}
	if token.Room != golden.Room || token.ExpiresAt != golden.ExpiresAt || token.TTLSeconds != golden.TTLSeconds {
		t.Errorf("cevap alanlari: %+v, altin %+v", token, golden)
	}
}
