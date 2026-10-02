package auth

import (
	"math"
	"strings"
	"testing"
)

func validAddressInput() AddressInput {
	return AddressInput{
		Title: "  Ev  ", Kind: AddressKindHome, Line: "  Acıbadem, Almondhill Sitesi 19C3, 34660 Üsküdar/İstanbul, Türkiye ",
		Location: &GeoPoint{Lat: 40.9885, Lng: 29.027}, Building: " 19C3 ", Floor: "3", Apartment: "12", Note: " Kapıda zil var ",
	}
}

func TestAddressCheckAcceptsValidInputAndTrimsText(t *testing.T) {
	input := validAddressInput()

	if problems := input.Check(); len(problems) != 0 {
		t.Fatalf("gecerli girdi reddedildi: %v", problems)
	}
	got := input.Address()
	if got.Title != "Ev" || got.Building != "19C3" || got.Note != "Kapıda zil var" || strings.HasPrefix(got.Line, " ") || strings.HasSuffix(got.Line, " ") {
		t.Errorf("metinler kirpilmali: %+v", got)
	}
	if got.Kind != AddressKindHome || got.Location != (GeoPoint{Lat: 40.9885, Lng: 29.027}) || got.Floor != "3" || got.Apartment != "12" {
		t.Errorf("alanlar adrese tasinmali: %+v", got)
	}
}

func TestAddressCheckAllowsEmptyOptionalFields(t *testing.T) {
	input := AddressInput{Title: "İş", Kind: AddressKindWork, Line: "Barbaros Blv. 40", Location: &GeoPoint{Lat: 41.04, Lng: 29.007}}

	if problems := input.Check(); len(problems) != 0 {
		t.Errorf("bina, kat, daire ve tarif istege bagli olmali: %v", problems)
	}
}

func TestAddressCheckCollectsEveryProblem(t *testing.T) {
	long := func(n int) string { return strings.Repeat("ş", n) }
	input := AddressInput{
		Title: "   ", Kind: "EV", Line: long(addressLineMaxLength + 1), Location: nil,
		Building: long(AddressUnitMaxLength + 1), Floor: long(AddressUnitMaxLength + 1), Apartment: long(AddressUnitMaxLength + 1),
		Note: long(addressNoteMaxLength + 1),
	}

	problems := input.Check()

	want := map[string]string{
		FieldTitle:     addressTitleRequiredReason,
		FieldKind:      addressKindReason,
		FieldLine:      addressLineMaxReason,
		FieldLocation:  addressRequiredReason,
		FieldBuilding:  "Bina en fazla 20 karakter olabilir",
		FieldFloor:     "Kat en fazla 20 karakter olabilir",
		FieldApartment: "Daire en fazla 20 karakter olabilir",
		FieldNote:      addressNoteMaxReason,
	}
	if len(problems) != len(want) {
		t.Errorf("tum sorunlar tek seferde donmeli:\n got %v\nwant %v", problems, want)
	}
	for field, reason := range want {
		if problems[field] != reason {
			t.Errorf("%s: %q bekleniyordu, %q geldi", field, reason, problems[field])
		}
	}
}

func TestAddressCheckCountsCharactersNotBytes(t *testing.T) {
	// Turkce harf 2 bayttir; sinir sozlesmedeki gibi KARAKTER sayar.
	input := validAddressInput()
	input.Title = strings.Repeat("ğ", AddressTitleMaxLength)
	input.Building = strings.Repeat("ü", AddressUnitMaxLength)

	if problems := input.Check(); len(problems) != 0 {
		t.Errorf("sinirdaki Turkce metin gecmeli: %v", problems)
	}
	input.Title += "ğ"
	if problems := input.Check(); problems[FieldTitle] != addressTitleMaxReason {
		t.Errorf("sinir asilinca baslik reddedilmeli: %v", problems)
	}
}

func TestAddressCheckRejectsCoordinatesOutOfRange(t *testing.T) {
	cases := []struct {
		name  string
		point GeoPoint
		bad   []string
	}{
		{"enlem buyuk", GeoPoint{Lat: 90.01, Lng: 29}, []string{"location.lat"}},
		{"boylam kucuk", GeoPoint{Lat: 41, Lng: -180.01}, []string{"location.lng"}},
		{"sayi degil", GeoPoint{Lat: math.NaN(), Lng: math.Inf(1)}, []string{"location.lat", "location.lng"}},
		{"sinirlar dahil", GeoPoint{Lat: -90, Lng: 180}, nil},
	}
	for _, tc := range cases {
		input := validAddressInput()
		input.Location = &tc.point

		problems := input.Check()

		if len(problems) != len(tc.bad) {
			t.Errorf("%s: %v sorunlari bekleniyordu, %v geldi", tc.name, tc.bad, problems)
		}
		for _, field := range tc.bad {
			if problems[field] == "" {
				t.Errorf("%s: %s sorunu bekleniyordu: %v", tc.name, field, problems)
			}
		}
	}
}
