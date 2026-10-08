package order

import (
	"regexp"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"
)

// OrderThreeDS, GET /v1/orders/{id}'deki bekleyen 3DS dogrulamasi
// (orderThreeDsSchema; #163 B1): sayfa yenilense de dogrulama kaldigi yerden
// surer. Yalnizca AWAITING_PAYMENT siparis, yalnizca sahibine (order-service
// GetOrder) ve onbelleklenmeden (no-store) doner. Kod (OTP) hicbir yerde yok.
//
//   - acik  : ChallengeID var, TTLSeconds >= 1, AttemptsLeft >= 1.
//   - kapali: ChallengeID YOK (gelse de atilir); TTLSeconds 0 suresi doldu,
//     AttemptsLeft 0 hakki bitti. Saat yarisinda ikisi de > 0 olabilir: payment
//     jeton gondermediyse dogrulama yine kapalidir.
//
// TEK SAAT: kalan sure payment'in bitis anindan GATEWAY'in saatiyle hesaplanir
// ve acik/kapali karari o hesaba gore verilir. Sinir Confirm3Ds'inkiyle ayni:
// now >= bitis ise sure 0 ve dogrulama kapali.
//
// ChallengeID bir yetenek jetonudur (oturumla birlikte kod girmeye yeter):
// gunluge, hata nedenine (Cause) ve metrik etiketine yazilmaz; bu dosya hata
// URETMEZ, bozuk durum yalnizca "alan yok" olur.
type OrderThreeDS struct {
	ChallengeID  string `json:"challengeId,omitempty"`
	TTLSeconds   int64  `json:"ttlSeconds"`
	AttemptsLeft int32  `json:"attemptsLeft"`
}

// threeDSOpenMinimum, acik dogrulamanin kalan saniye ve hak alt siniri
// (openOrderThreeDsSchema'da ikisi de min(1); sozlesme testi denetler).
const threeDSOpenMinimum = 1

// threeDSChallengeIDPattern, Confirm3Ds jetonunun bicimi
// (threeDsChallengeIdSchema: `tds_` + 32 kucuk onaltilik; sozlesme testi denetler).
const threeDSChallengeIDPattern = `^tds_[0-9a-f]{32}$`

var threeDSChallengeID = regexp.MustCompile(threeDSChallengeIDPattern)

// toOrderThreeDS, order'in tasidigi payment durumunu REST bicimine cevirir.
// nil = alan yok ("bilinmiyor" ya da dogrulama yok): durum gelmediyse, siparis
// odeme beklemiyorsa ya da durum sozlesmeyi bozuyorsa (bitis yok, negatif hak,
// acik dogrulamada bicimsiz jeton). Bozuk durum siparis okumasini DUSURMEZ.
//
// 3DS durumunun gorunebildigi TEK siparis durumu AWAITING_PAYMENT'tir (proto
// degeriyle karsilastirilir; REST adi degisse de kural kaymaz).
func toOrderThreeDS(status *paymentv1.ThreeDsStatus, orderStatus orderv1.OrderStatus, now time.Time) *OrderThreeDS {
	if status == nil || orderStatus != orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT ||
		status.GetExpiresAt() == nil || status.GetAttemptsLeft() < 0 {
		return nil
	}
	view := &OrderThreeDS{
		TTLSeconds:   secondsUntil(status.GetExpiresAt(), now),
		AttemptsLeft: status.GetAttemptsLeft(),
	}
	challengeID := status.GetChallengeId()
	if challengeID == "" || view.TTLSeconds < threeDSOpenMinimum || view.AttemptsLeft < threeDSOpenMinimum {
		return view
	}
	if !threeDSChallengeID.MatchString(challengeID) {
		return nil
	}
	view.ChallengeID = challengeID
	return view
}

// secondsUntil, bitise `now`'a gore kalan TAM saniye (asagi yuvarlanir: 0,9 sn
// kalmis kod "0" der, istemci dolmak uzere olan koda girmeye calismaz); now >=
// bitis ise 0. Rezervasyon geri sayimi (remainingSeconds) bilerek yukari yuvarlar.
func secondsUntil(expiresAt *timestamppb.Timestamp, now time.Time) int64 {
	remaining := expiresAt.AsTime().Sub(now)
	if remaining <= 0 {
		return 0
	}
	return int64(remaining / time.Second)
}
