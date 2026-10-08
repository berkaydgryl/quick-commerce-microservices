package tracking

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// ShortCourierName, kuryenin gosterim adi (#183): ilk ad ve SON soyadin bas
// harfi ("Mehmet Kaya" -> "Mehmet K."; "Ayşe Nur Yılmaz Demir" -> "Ayşe D.").
// Tam ad gateway'den CIKMAZ: courier tam adi gonderse de istemciye kisaltilmis
// gider (kaynaktaki kisaltma ayri is). Tek kelimelik ad ("Kurye", courier'in
// yedek adi) oldugu gibi kalir; zaten kisa ad degismez ("Mehmet K.").
//
// Bas harf TURKCE kuralla buyutulur (unicode.TurkishCase): "i" -> "İ", "ı" -> "I".
// Bas harf soyadin ilk HARFIDIR ("Mehmet (Kaya)" -> "Mehmet K."); soyadda
// harf yoksa ("Ali 2") yalnizca ilk ad kalir. Ayrac her bosluk karakteridir
// (coklu bosluk, sekme). Bos ad bos doner; sozlesme denetimi (invariants.go)
// onu ayrica reddeder.
func ShortCourierName(fullName string) string {
	parts := strings.Fields(fullName)
	if len(parts) < 2 {
		return strings.Join(parts, "")
	}
	surname := parts[len(parts)-1]
	letter := strings.IndexFunc(surname, unicode.IsLetter)
	if letter < 0 {
		return parts[0]
	}
	initial, _ := utf8.DecodeRuneInString(surname[letter:])
	return parts[0] + " " + string(unicode.TurkishCase.ToUpper(initial)) + "."
}
