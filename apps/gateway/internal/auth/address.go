package auth

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

// Adres ekleme kurallari (T11.8; @getir/contracts createAddressRequestSchema).
// Degerler ve cumleler sozlesmeyle AYNIDIR; rules_contract_test.go karsilastirir.
const (
	// AddressTitleMaxLength, kayitli adresin adi ("Ev", "Is").
	AddressTitleMaxLength = 40
	// AddressUnitMaxLength, bina, kat ve daire alanlari ("19C3", "3", "12").
	AddressUnitMaxLength = 20
	// addressLineMaxLength ve addressNoteMaxLength: ADDRESS_LINE_MAX_LENGTH,
	// ADDRESS_NOTE_MAX_LENGTH.
	addressLineMaxLength = 240
	addressNoteMaxLength = 240
)

// Adres turleri (@getir/contracts addressKindSchema).
const (
	AddressKindHome  = "HOME"
	AddressKindWork  = "WORK"
	AddressKindOther = "OTHER"
)

// Alan adlari: istek govdesindekiyle ayni.
const (
	FieldTitle     = "title"
	FieldKind      = "kind"
	FieldLine      = "line"
	FieldLocation  = "location"
	FieldBuilding  = "building"
	FieldFloor     = "floor"
	FieldApartment = "apartment"
	FieldNote      = "note"
	// FieldAddresses, defterin kendisine ait sorun (dolu defter).
	FieldAddresses = "addresses"
)

// Sebepler: web formu alanin altinda gosterir; sozlesmedeki cumlelerle ayni.
// Ad catismasi ve dolu defter yalnizca sunucunun bildigi kurallardir.
const (
	addressTitleRequiredReason = "Başlık boş olamaz"
	addressTitleMaxReason      = "Başlık en fazla 40 karakter olabilir"
	addressLineRequiredReason  = "Adres boş olamaz"
	addressLineMaxReason       = "Adres en fazla 240 karakter olabilir"
	addressNoteMaxReason       = "Adres tarifi en fazla 240 karakter olabilir"
	addressKindReason          = "HOME, WORK ya da OTHER olmalı"
	addressRequiredReason      = "zorunlu"
	addressLatitudeReason      = "enlem -90 ile 90 arasinda olmali"
	addressLongitudeReason     = "boylam -180 ile 180 arasinda olmali"
	addressTitleTakenReason    = "Bu adla kayıtlı bir adresin var"
	addressBookFullReason      = "En fazla 10 adres kaydedebilirsin"
)

// AddressInput, adres ekleme girdisi (POST /v1/me/addresses).
type AddressInput struct {
	Title     string
	Kind      string
	Line      string
	Location  *GeoPoint
	Building  string
	Floor     string
	Apartment string
	Note      string
}

// Check, girdiyi dogrular ve metinleri kirpar. Hatalar alan -> sebep
// haritasidir; bossa girdi gecerlidir.
func (in *AddressInput) Check() map[string]string {
	in.Title = strings.TrimSpace(in.Title)
	in.Line = strings.TrimSpace(in.Line)
	in.Building = strings.TrimSpace(in.Building)
	in.Floor = strings.TrimSpace(in.Floor)
	in.Apartment = strings.TrimSpace(in.Apartment)
	in.Note = strings.TrimSpace(in.Note)

	problems := map[string]string{}
	checkRequiredText(problems, FieldTitle, in.Title, AddressTitleMaxLength, addressTitleRequiredReason, addressTitleMaxReason)
	checkRequiredText(problems, FieldLine, in.Line, addressLineMaxLength, addressLineRequiredReason, addressLineMaxReason)
	switch in.Kind {
	case AddressKindHome, AddressKindWork, AddressKindOther:
	default:
		problems[FieldKind] = addressKindReason
	}
	checkLocation(problems, in.Location)
	for field, unit := range map[string]struct{ label, value string }{
		FieldBuilding:  {"Bina", in.Building},
		FieldFloor:     {"Kat", in.Floor},
		FieldApartment: {"Daire", in.Apartment},
	} {
		if utf8.RuneCountInString(unit.value) > AddressUnitMaxLength {
			problems[field] = fmt.Sprintf("%s en fazla %d karakter olabilir", unit.label, AddressUnitMaxLength)
		}
	}
	if utf8.RuneCountInString(in.Note) > addressNoteMaxLength {
		problems[FieldNote] = addressNoteMaxReason
	}
	return problems
}

// Address, dogrulanmis girdinin kayitli adresi.
func (in AddressInput) Address() SavedAddress {
	address := SavedAddress{
		Title: in.Title, Kind: in.Kind, Line: in.Line,
		Building: in.Building, Floor: in.Floor, Apartment: in.Apartment, Note: in.Note,
	}
	if in.Location != nil {
		address.Location = *in.Location
	}
	return address
}

func checkRequiredText(problems map[string]string, field, value string, maxLength int, requiredReason, maxReason string) {
	switch length := utf8.RuneCountInString(value); {
	case length == 0:
		problems[field] = requiredReason
	case length > maxLength:
		problems[field] = maxReason
	}
}

// checkLocation: konum zorunlu; koordinatlar sonlu ve WGS84 araliginda.
func checkLocation(problems map[string]string, location *GeoPoint) {
	if location == nil {
		problems[FieldLocation] = addressRequiredReason
		return
	}
	if math.IsNaN(location.Lat) || math.IsInf(location.Lat, 0) || location.Lat < -90 || location.Lat > 90 {
		problems[FieldLocation+".lat"] = addressLatitudeReason
	}
	if math.IsNaN(location.Lng) || math.IsInf(location.Lng, 0) || location.Lng < -180 || location.Lng > 180 {
		problems[FieldLocation+".lng"] = addressLongitudeReason
	}
}
