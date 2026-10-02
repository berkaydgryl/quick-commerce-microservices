package geo

import (
	"strings"
	"unicode/utf8"
)

// address, Nominatim'in adres alanlari (Turkiye'de kullanilanlar). Ayni
// kademe farkli yerlerde farkli adla gelir: mahalle cogu yerde "suburb",
// ilce "town", il "province"dir; digerleri yedektir.
type address struct {
	HouseNumber   string `json:"house_number"`
	Road          string `json:"road"`
	Suburb        string `json:"suburb"`
	Neighbourhood string `json:"neighbourhood"`
	Quarter       string `json:"quarter"`
	Village       string `json:"village"`
	Town          string `json:"town"`
	CityDistrict  string `json:"city_district"`
	County        string `json:"county"`
	District      string `json:"district"`
	Province      string `json:"province"`
	City          string `json:"city"`
	State         string `json:"state"`
	Postcode      string `json:"postcode"`
	Country       string `json:"country"`
}

// line, yerin Turkce adres satiri; adres formuna oldugu gibi yazilir:
//
//	"Osmanağa Mahallesi, Nail Bey Sokağı 23, 34710 Kadıköy/İstanbul, Türkiye"
//
// Alanlardan en az iki parca kurulamazsa Nominatim'in kendi metni
// (display_name) kullanilir. Satir ADDRESS_LINE_MAX_LENGTH'e kirpilir.
func (p place) line() string {
	a := p.Address
	street := a.Road
	if street != "" && a.HouseNumber != "" {
		street += " " + a.HouseNumber
	}
	district := firstOf(a.Town, a.CityDistrict, a.County, a.District)
	province := firstOf(a.Province, a.City, a.State)
	locality := joinNonEmpty("/", district, province)
	if district == province {
		locality = district
	}
	parts := nonEmpty(
		firstOf(a.Suburb, a.Neighbourhood, a.Quarter, a.Village),
		street,
		joinNonEmpty(" ", a.Postcode, locality),
		a.Country,
	)
	line := strings.Join(parts, ", ")
	if len(parts) < 2 {
		line = strings.TrimSpace(p.DisplayName)
	}
	return truncate(line, lineMaxLength)
}

func firstOf(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func nonEmpty(values ...string) []string {
	kept := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			kept = append(kept, value)
		}
	}
	return kept
}

func joinNonEmpty(separator string, values ...string) string {
	return strings.Join(nonEmpty(values...), separator)
}

// truncate, metni en fazla limit karaktere kirpar (bayta degil: Turkce harf
// ortasindan bolunmez).
func truncate(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return strings.TrimSpace(string([]rune(text)[:limit]))
}
