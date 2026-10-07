package content

import (
	"strings"
	"testing"
)

func TestCheckCheckoutRequiresEveryList(t *testing.T) {
	valid := Checkout{
		PresetNotes:             []string{"İyi ki doğdun!"},
		PreInfoParagraphs:       []string{"Demo."},
		DistanceSalesParagraphs: []string{"Demo."},
	}
	if err := checkCheckout(valid); err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
	for name, broken := range map[string]Checkout{
		"presetNotes":             {PreInfoParagraphs: valid.PreInfoParagraphs, DistanceSalesParagraphs: valid.DistanceSalesParagraphs},
		"preInfoParagraphs":       {PresetNotes: valid.PresetNotes, DistanceSalesParagraphs: valid.DistanceSalesParagraphs},
		"distanceSalesParagraphs": {PresetNotes: valid.PresetNotes, PreInfoParagraphs: valid.PreInfoParagraphs},
	} {
		err := checkCheckout(broken)
		if err == nil || !strings.Contains(err.Error(), "checkout."+name) {
			t.Errorf("%s bos iken hata bekleniyordu, %v", name, err)
		}
	}
}
