package cards

import (
	"strings"
	"testing"
)

const addBody = `{"number":"4242 4242 4242 4242","expiryMonth":12,"expiryYear":2031,"cvv":"987","holderName":"Ayşe Yılmaz","nickname":"Maaş"}`

func TestFingerprintBodyHasNoCardNumberOrCVV(t *testing.T) {
	// K3: parmak izi girdisi numaranin ve CVV'nin hicbir parcasini tasimaz.
	canonical := string(FingerprintBody([]byte(addBody)))

	for _, secret := range []string{"4242424242424242", "4242 4242 4242 4242", "987", "cvv"} {
		if strings.Contains(canonical, secret) {
			t.Errorf("parmak izi girdisinde %q var: %s", secret, canonical)
		}
	}
	want := `{"expiryMonth":12,"expiryYear":2031,"holderName":"Ayşe Yılmaz","nickname":"Maaş","number":"4242...4242/16"}`
	if canonical != want {
		t.Errorf("kanonik govde:\n got %s\nwant %s", canonical, want)
	}
}

func TestFingerprintBodyIgnoresCVVAndSpacingButNotTheCard(t *testing.T) {
	same := strings.NewReplacer(`"987"`, `"123"`, "4242 4242 4242 4242", "4242-4242-4242-4242").Replace(addBody)
	otherCard := strings.Replace(addBody, "4242 4242 4242 4242", "5555 5555 5555 4444", 1)
	otherExpiry := strings.Replace(addBody, `"expiryYear":2031`, `"expiryYear":2032`, 1)

	base := string(FingerprintBody([]byte(addBody)))
	if got := string(FingerprintBody([]byte(same))); got != base {
		t.Errorf("CVV ve ayrac farki ayni istek sayilmali:\n%s\n%s", got, base)
	}
	for name, body := range map[string]string{"farkli kart": otherCard, "farkli son kullanma": otherExpiry} {
		if string(FingerprintBody([]byte(body))) == base {
			t.Errorf("%s farkli istek sayilmali (409)", name)
		}
	}
}

func TestFingerprintBodyDropsUnknownAndUnparsable(t *testing.T) {
	// Bilinmeyen alan (numara baska adla) ve cozulemeyen govde girmez.
	withPan := strings.Replace(addBody, `"cvv":"987"`, `"pan":"4242424242424242"`, 1)
	if got := string(FingerprintBody([]byte(withPan))); strings.Contains(got, "4242424242424242") {
		t.Errorf("bilinmeyen alan girdi: %s", got)
	}
	if got := string(FingerprintBody([]byte(`{"number": 4242 4242`))); got != unparsableBody {
		t.Errorf("cozulemeyen govde sabit isaret olmali: %s", got)
	}
	if got := string(FingerprintBody([]byte(`{"number":"4242abcd42424242"}`))); strings.Contains(got, "4242") {
		t.Errorf("bicimsiz numara yalnizca uzunluk tasimali: %s", got)
	}
}

func TestFingerprintBodyMatchesFieldNamesCaseInsensitively(t *testing.T) {
	// Go cozucusu "Number"i number alanina yazar: farkli kart buyuk harfli adla
	// gelse de parmak izi farkli olmali (ayni anahtarla yanlis tekrar olmasin).
	lower := `{"number":"4242 4242 4242 4242","expiryMonth":12,"expiryYear":2031,"holderName":"A B"}`
	upper := `{"Number":"5555 5555 5555 4444","expiryMonth":12,"expiryYear":2031,"holderName":"A B"}`
	sameUpper := `{"NUMBER":"4242424242424242","ExpiryMonth":12,"expiryyear":2031,"HolderName":"A B"}`

	if string(FingerprintBody([]byte(lower))) == string(FingerprintBody([]byte(upper))) {
		t.Error("buyuk harfli adla gelen farkli kart ayni parmak izini almamali")
	}
	if got, want := string(FingerprintBody([]byte(sameUpper))), string(FingerprintBody([]byte(lower))); got != want {
		t.Errorf("ayni kart farkli yazimla ayni parmak izi:\n got %s\nwant %s", got, want)
	}
	if got := string(FingerprintBody([]byte(`{"CVV":"987","Cvv":"123"}`))); strings.Contains(got, "987") || strings.Contains(got, "123") {
		t.Errorf("CVV hicbir yazimla girmemeli: %s", got)
	}
}
