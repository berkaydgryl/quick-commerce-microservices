package testkit

import (
	"strings"
	"testing"
)

func TestWithoutRandomNoiseMasksIDsAndRandomFields(t *testing.T) {
	// #132'nin CI'da dusen dizesi: istek kimliginde tesadufen "9183" gecer.
	line := `{"requestId":"req_8b21ab37ec584a9183af1f3aa53152d7","durationMs":918.3,"time":"2026-10-05T12:00:09.183Z"}`
	if !strings.Contains(line, "9183") {
		t.Fatal("deney dizesi 9183 icermeli")
	}
	if masked := WithoutRandomNoise(line); strings.Contains(masked, "9183") {
		t.Errorf("rastgele gurultu maskelenmedi: %s", masked)
	}
}

func TestWithoutRandomNoiseKeepsLeaks(t *testing.T) {
	// Sizinti GORUNUR kalir: kart numarasi, CVV degeri, oneksiz onaltilik, jeton.
	text := `{"number":"4242424242424242","cvv":"9183","hex":"8b21ab37ec584a9183af1f3aa53152d7","token":"tok_test_4242"}`
	if masked := WithoutRandomNoise(text); masked != text {
		t.Errorf("sizinti maskelendi:\n got %s\nwant %s", masked, text)
	}
}
