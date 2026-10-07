package tracking

import (
	"strings"
	"testing"

	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kurye adinin kisaltilmasi (#183): tam ad gateway'den cikmaz.

func TestShortCourierName(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{name: "ad soyad", in: "Mehmet Kaya", want: "Mehmet K."},
		// Turkce kural: strings.ToUpper("i") "I" verirdi.
		{name: "noktali i -> İ", in: "Ali işık", want: "Ali İ."},
		{name: "noktasiz ı -> I", in: "Ayşe ılgaz", want: "Ayşe I."},
		{name: "Ş", in: "Can şahin", want: "Can Ş."},
		{name: "Ö", in: "Ömer öztürk", want: "Ömer Ö."},
		{name: "ikinci ad ve iki soyad: son soyad", in: "Ayşe Nur Yılmaz Demir", want: "Ayşe D."},
		{name: "tireli soyad", in: "Zeynep Çelik-Öztürk", want: "Zeynep Ç."},
		{name: "coklu bosluk", in: "Mehmet    Kaya", want: "Mehmet K."},
		{name: "sekme", in: "Mehmet\tKaya", want: "Mehmet K."},
		{name: "bosluk ve sekme karisik", in: " \tMehmet \t  Kaya\t ", want: "Mehmet K."},
		{name: "satir sonu", in: "Mehmet\nKaya", want: "Mehmet K."},
		{name: "zaten kisa", in: "Mehmet K.", want: "Mehmet K."},
		// Bas harf soyadin ilk HARFI; harf yoksa yalnizca ilk ad.
		{name: "parantezli soyad", in: "Mehmet (Kaya)", want: "Mehmet K."},
		{name: "tirnakli soyad", in: "Mehmet 'ilhan'", want: "Mehmet İ."},
		{name: "soyadda harf yok", in: "Ali 2", want: "Ali"},
		{name: "tek kelime (courier yedek adi)", in: "Kurye", want: "Kurye"},
		{name: "tek kelime, bosluklu", in: "  Kurye\t", want: "Kurye"},
		{name: "bos", in: "", want: ""},
		{name: "yalniz bosluk", in: " \t ", want: ""},
	} {
		if got := ShortCourierName(tc.in); got != tc.want {
			t.Errorf("%s: %q -> %q bekleniyordu, %q", tc.name, tc.in, tc.want, got)
		}
	}
}

func TestTrackSendsOnlyTheShortCourierName(t *testing.T) {
	// Courier tam ad gonderse de cevapta (JSON dahil) soyad yok.
	response := trackingIn(courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER)
	response.CourierName = "Mehmet Ali   Kaya"

	got, err := newService(&fakeOrders{status: "ON_THE_WAY"}, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)

	if err != nil || got.Courier.Name != "Mehmet K." {
		t.Fatalf("kisaltilmis ad bekleniyordu: %q %v", got.Courier.Name, err)
	}
	if body := testkit.JSON(t, got); strings.Contains(body, "Kaya") || strings.Contains(body, "Ali") {
		t.Errorf("tam ad cevaba girmemeli: %s", body)
	}
}
