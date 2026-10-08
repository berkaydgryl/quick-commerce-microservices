package order

import (
	"context"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Siparis ayrintisindaki 3DS durumu (#163 B1): acik / kapali / yok, tek saat
// (gateway'in saati), saat sinirinin iki yani, hak sinirinin iki yani ve
// jetonun kapali durumda ATILMASI. Jeton hicbir hataya girmez.

const testChallengeID = "tds_0009d7cd0e904b689aabcacf4458d520"

var threeDSNow = time.Date(2026, 10, 8, 9, 0, 0, 0, time.UTC)

func awaitingOrder() *orderv1.Order {
	return &orderv1.Order{Id: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT, CreatedAt: timestamppb.New(threeDSNow)}
}

func threeDSStatus(challengeID string, left time.Duration, attempts int32) *paymentv1.ThreeDsStatus {
	return &paymentv1.ThreeDsStatus{ChallengeId: challengeID, ExpiresAt: timestamppb.New(threeDSNow.Add(left)), AttemptsLeft: attempts}
}

// detailWith, sahte order'in verdigi siparis ve 3DS durumuyla GetDetailed'i
// gateway saati threeDSNow iken calistirir.
func detailWith(t *testing.T, raw *orderv1.Order, status *paymentv1.ThreeDsStatus) OrderDetail {
	t.Helper()
	service := startStub(t, &stubServer{order: raw, threeDS: status})
	service.now = func() time.Time { return threeDSNow }
	detail, err := service.GetDetailed(context.Background(), "usr_1", orderID)
	if err != nil {
		t.Fatalf("3DS durumu siparis okumasini dusurmemeli: %v", err)
	}
	return detail
}

func TestOrderThreeDSOpenClosedAndClockBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status *paymentv1.ThreeDsStatus
		want   string
	}{
		{"acik, kalan sure ASAGI yuvarlanir (42,9 -> 42)", threeDSStatus(testChallengeID, 42*time.Second+900*time.Millisecond, 2),
			`{"challengeId":"` + testChallengeID + `","ttlSeconds":42,"attemptsLeft":2}`},
		{"saat siniri: 1 sn kaldi, acik", threeDSStatus(testChallengeID, time.Second, 2),
			`{"challengeId":"` + testChallengeID + `","ttlSeconds":1,"attemptsLeft":2}`},
		{"saat siniri: 0,999 sn kaldi, kapali (jeton atilir)", threeDSStatus(testChallengeID, 999*time.Millisecond, 2),
			`{"ttlSeconds":0,"attemptsLeft":2}`},
		{"saat siniri: now == bitis, kapali (Confirm3Ds ile ayni sinir)", threeDSStatus(testChallengeID, 0, 2),
			`{"ttlSeconds":0,"attemptsLeft":2}`},
		{"kayan saat: bitis gecmiste, sure negatif degil 0", threeDSStatus(testChallengeID, -90*time.Second, 2),
			`{"ttlSeconds":0,"attemptsLeft":2}`},
		{"hak siniri: 1 hak, acik", threeDSStatus(testChallengeID, 31*time.Second, 1),
			`{"challengeId":"` + testChallengeID + `","ttlSeconds":31,"attemptsLeft":1}`},
		{"hak siniri: 0 hak, kapali (hakki bitti; sure olsa da jeton atilir)", threeDSStatus(testChallengeID, 31*time.Second, 0),
			`{"ttlSeconds":31,"attemptsLeft":0}`},
		{"ikisi de 0: kapali", threeDSStatus(testChallengeID, -time.Second, 0),
			`{"ttlSeconds":0,"attemptsLeft":0}`},
		{"saat yarisi: payment kapali dedi (jetonsuz), gateway 1 sn diyor: kapali", threeDSStatus("", time.Second, 2),
			`{"ttlSeconds":1,"attemptsLeft":2}`},
		{"kapali durumda bicimsiz jeton da atilir", threeDSStatus("tds_1", 0, 2),
			`{"ttlSeconds":0,"attemptsLeft":2}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			detail := detailWith(t, awaitingOrder(), tc.status)

			if got := testkit.JSON(t, detail.ThreeDS); got != tc.want {
				t.Errorf("threeDs:\n got %s\nwant %s", got, tc.want)
			}
		})
	}
}

func TestOrderThreeDSAbsentWhenUnknownNotAwaitingOrBroken(t *testing.T) {
	paid := awaitingOrder()
	paid.Status = orderv1.OrderStatus_ORDER_STATUS_PAID
	noExpiry := threeDSStatus(testChallengeID, time.Minute, 2)
	noExpiry.ExpiresAt = nil
	for _, tc := range []struct {
		name   string
		raw    *orderv1.Order
		status *paymentv1.ThreeDsStatus
	}{
		{"order durum gondermedi (bilinmiyor ya da dogrulama yok)", awaitingOrder(), nil},
		{"siparis odeme beklemiyor", paid, threeDSStatus(testChallengeID, time.Minute, 2)},
		{"bitis yok (sozlesme bozuk)", awaitingOrder(), noExpiry},
		{"negatif hak (sozlesme bozuk)", awaitingOrder(), threeDSStatus(testChallengeID, time.Minute, -1)},
		{"acik dogrulamada bicimsiz jeton", awaitingOrder(), threeDSStatus("tds_1", time.Minute, 2)},
		{"acik dogrulamada buyuk harfli jeton", awaitingOrder(), threeDSStatus(strings.ToUpper(testChallengeID), time.Minute, 2)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			detail := detailWith(t, tc.raw, tc.status)

			if got := testkit.JSON(t, detail); detail.ThreeDS != nil || strings.Contains(got, "threeDs") || strings.Contains(got, "tds_") {
				t.Errorf("alan yazilmamali, jeton sizmamali: %s", got)
			}
		})
	}
}

func TestPlainGetNeverCarriesThreeDS(t *testing.T) {
	// Sahiplik denetimi (oda jetonu, takip, "zaten iptal") ayrintisiz Get'i
	// kullanir: 3DS jetonunu tasiyamaz.
	service := startStub(t, &stubServer{order: awaitingOrder(), threeDS: threeDSStatus(testChallengeID, time.Minute, 2)})

	found, err := service.Get(context.Background(), "usr_1", orderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if got := testkit.JSON(t, found); strings.Contains(got, "tds_") || strings.Contains(got, "threeDs") {
		t.Errorf("ayrintisiz okuma 3DS tasimamali: %s", got)
	}
}

func TestBrokenOrderErrorNeverCarriesTheChallengeID(t *testing.T) {
	// Siparis sozlesmeyi bozarsa (bilinmeyen durum) okuma INTERNAL olur; hata
	// metni ve nedeni (gunluge giden) jetonu TASIMAZ.
	broken := awaitingOrder()
	broken.Status = orderv1.OrderStatus(99)
	service := startStub(t, &stubServer{order: broken, threeDS: threeDSStatus(testChallengeID, time.Minute, 2)})

	_, err := service.GetDetailed(context.Background(), "usr_1", orderID)

	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodeInternal {
		t.Fatalf("INTERNAL bekleniyordu: %s", appErr.Code)
	}
	if text := err.Error() + " " + testkit.JSON(t, appErr.Details); strings.Contains(text, "tds_") {
		t.Errorf("hata jetonu tasimamali: %s", text)
	}
}
