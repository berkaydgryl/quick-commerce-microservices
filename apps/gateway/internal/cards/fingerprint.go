package cards

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"
)

// IdempotencyTTL, kart ekleme tekrar kaydinin omru (K3, QA S3): kisa. Kart
// eklemede tekrar dakikalar icinde gelir (cift tiklama, ag kaybi); varsayilan
// 24 saat gereksiz uzun.
const IdempotencyTTL = 15 * time.Minute

// unparsableBody, JSON nesnesi olmayan govdenin parmak izi girdisi: ham govde
// (numara tasiyabilir) parmak izine HIC girmez. Boyle govde 400 alir ve 400
// kaydedilmez; isaret yalnizca "isleniyor" suresince yasar.
const unparsableBody = "govde-cozulemedi"

// fingerprintFields, parmak izine giren alanlar. cvv YOK; number maskelenir.
// Bilinmeyen alan da girmez: numara baska adla gelse bile turevi tutulmasin.
var fingerprintFields = []string{"number", "expiryMonth", "expiryYear", "holderName", "nickname"}

// FingerprintBody, kart ekleme govdesinin tekrar korumasi parmak izine giren
// KANONIK MASKELI hali (K3, QA S3). Redis'teki kayit numaranin ve CVV'nin hicbir
// turevini (HMAC'ini bile) tasimaz:
//
//	number -> ilk 4 + son 4 + hane sayisi (bosluk ve tire atilir)
//	cvv    -> parmak izine girmez
//	digerleri oldugu gibi, anahtarlar sirali
//
// Ayni anahtarla farkli kart (ilk/son haneler, uzunluk, son kullanma ya da ad
// farkli) yine 409 alir. Yalnizca CVV'si farkli ayni kart ayni istek sayilir:
// istemci CVV'yi duzeltip yeniden denerken yeni anahtar uretir.
func FingerprintBody(body []byte) []byte {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		return []byte(unparsableBody)
	}
	// Go'nun JSON cozucusu alan adini buyuk-kucuk harf ayirmadan eslestirir
	// ("Number" de number alanina yazilir): parmak izi de ayni adlari ayni alan
	// sayar. Ayni alana birden cok yazim gelirse hepsi girer (sirali).
	grouped := make(map[string][]json.RawMessage, len(fingerprintFields))
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		name, known := fingerprintField(key)
		if !known {
			continue
		}
		value := fields[key]
		if name == "number" {
			value = maskedNumber(value)
		}
		grouped[name] = append(grouped[name], value)
	}
	canonical := make(map[string]any, len(grouped))
	for name, values := range grouped {
		if len(values) == 1 {
			canonical[name] = values[0]
		} else {
			canonical[name] = values
		}
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return []byte(unparsableBody)
	}
	return encoded
}

// fingerprintField, govdedeki anahtarin parmak izindeki adi (buyuk-kucuk harf
// ayirmadan); bilinmeyen anahtar girmez.
func fingerprintField(key string) (string, bool) {
	for _, name := range fingerprintFields {
		if strings.EqualFold(key, name) {
			return name, true
		}
	}
	return "", false
}

// maskedNumber, numaranin parmak izindeki hali: "4242...4242/16". Metin olmayan
// ya da rakam disi icerikte yalnizca tur ve uzunluk.
func maskedNumber(raw json.RawMessage) json.RawMessage {
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return quoted("metin-degil/" + strconv.Itoa(len(raw)))
	}
	digits := strings.NewReplacer(" ", "", "-", "").Replace(text)
	if digits == "" || strings.Trim(digits, "0123456789") != "" {
		return quoted("bicimsiz/" + strconv.Itoa(len(text)))
	}
	if len(digits) < 2*maskDigits {
		return quoted("kisa/" + strconv.Itoa(len(digits)))
	}
	return quoted(digits[:maskDigits] + "..." + digits[len(digits)-maskDigits:] + "/" + strconv.Itoa(len(digits)))
}

// maskDigits, maskede kalan bas ve son hane sayisi (kasanin first4/last4'u gibi).
const maskDigits = 4

func quoted(text string) json.RawMessage {
	encoded, err := json.Marshal(text)
	if err != nil {
		return json.RawMessage(`""`)
	}
	return encoded
}
