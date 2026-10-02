package geo

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestLineFollowsTurkishAddressOrder(t *testing.T) {
	cases := []struct {
		name  string
		place place
		want  string
	}{
		{
			name: "tam adres",
			place: place{Address: address{
				HouseNumber: "23", Road: "Nail Bey Sokağı", Suburb: "Osmanağa Mahallesi", Town: "Kadıköy",
				Province: "İstanbul", Postcode: "34710", Country: "Türkiye",
			}},
			want: "Osmanağa Mahallesi, Nail Bey Sokağı 23, 34710 Kadıköy/İstanbul, Türkiye",
		},
		{
			name: "kapi numarasi ve posta kodu yok, mahalle quarter'da",
			place: place{Address: address{
				Road: "Moda Caddesi", Quarter: "Moda", County: "Kadıköy", City: "İstanbul", Country: "Türkiye",
			}},
			want: "Moda, Moda Caddesi, Kadıköy/İstanbul, Türkiye",
		},
		{
			name:  "ilce ile il ayni ad",
			place: place{Address: address{Road: "Atatürk Caddesi", Town: "Bolu", Province: "Bolu", Postcode: "14100", Country: "Türkiye"}},
			want:  "Atatürk Caddesi, 14100 Bolu, Türkiye",
		},
		{
			name:  "yolsuz kapi numarasi yazilmaz",
			place: place{Address: address{HouseNumber: "5", Suburb: "Caferağa Mahallesi", Country: "Türkiye"}},
			want:  "Caferağa Mahallesi, Türkiye",
		},
		{
			name:  "tek parca: Nominatim'in metni",
			place: place{DisplayName: "  Kız Kulesi, Üsküdar, İstanbul  ", Address: address{Country: "Türkiye"}},
			want:  "Kız Kulesi, Üsküdar, İstanbul",
		},
		{
			name:  "hicbir sey yok",
			place: place{},
			want:  "",
		},
	}
	for _, tc := range cases {
		if got := tc.place.line(); got != tc.want {
			t.Errorf("%s:\n got %q\nwant %q", tc.name, got, tc.want)
		}
	}
}

func TestLineIsTruncatedToAddressLimit(t *testing.T) {
	long := place{DisplayName: strings.Repeat("Çağlayan ", 40)}

	line := long.line()

	if utf8.RuneCountInString(line) > lineMaxLength || !utf8.ValidString(line) || strings.HasSuffix(line, " ") {
		t.Errorf("satir %d karaktere kirpilmali, gecerli UTF-8 kalmali: %d %q", lineMaxLength, utf8.RuneCountInString(line), line)
	}
}
