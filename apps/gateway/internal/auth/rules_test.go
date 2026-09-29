package auth

import (
	"strings"
	"testing"
)

const validPhone = "+905321234567"

func TestRegisterCheckAcceptsValidInputAndTrimsName(t *testing.T) {
	input := RegisterInput{Phone: validPhone, Password: "Gizli-Parola-2026", FullName: "  Ayse Yilmaz  "}

	if problems := input.Check(); len(problems) != 0 {
		t.Fatalf("gecerli girdi reddedildi: %v", problems)
	}
	if input.FullName != "Ayse Yilmaz" {
		t.Errorf("ad kirpilmali: %q", input.FullName)
	}
}

func TestPhoneRule(t *testing.T) {
	for _, phone := range []string{"", "05321234567", "5321234567", "+9053212345678", "+90532123456", "+905321234a67", " +905321234567", "+445321234567"} {
		if problems := (LoginInput{Phone: phone, Password: "Gizli-Parola-2026"}).Check(); problems[FieldPhone] != phoneReason {
			t.Errorf("%q reddedilmeliydi: %v", phone, problems)
		}
	}
}

func TestPasswordRuleCountsCharactersBelowAndBytesAbove(t *testing.T) {
	cases := []struct {
		name, password, reason string
	}{
		{"7 karakter", "1234567", passwordMinReason},
		{"8 karakter", "12345678", ""},
		// Alt sinir KARAKTER: 8 Turkce harf (16 bayt) yeterli.
		{"8 Turkce harf", strings.Repeat("ş", 8), ""},
		{"72 bayt ASCII", strings.Repeat("a", 72), ""},
		{"73 bayt ASCII", strings.Repeat("a", 73), passwordMaxReason},
		// Ust sinir BAYT: 36 x "ş" = 72 bayt gecer, 37 x "ş" = 74 bayt gecmez.
		{"36 Turkce harf", strings.Repeat("ş", 36), ""},
		{"37 Turkce harf", strings.Repeat("ş", 37), passwordMaxReason},
	}
	for _, tc := range cases {
		problems := (LoginInput{Phone: validPhone, Password: tc.password}).Check()
		if problems[FieldPassword] != tc.reason {
			t.Errorf("%s: %q bekleniyordu, %q geldi", tc.name, tc.reason, problems[FieldPassword])
		}
	}
}

func TestFullNameRuleCountsCharactersAfterTrim(t *testing.T) {
	cases := []struct {
		name, fullName, reason string
	}{
		{"bos", "", fullNameMinReason},
		{"yalnizca bosluk", "    ", fullNameMinReason},
		{"tek harf", " A ", fullNameMinReason},
		{"iki harf", "Al", ""},
		{"80 Turkce harf", strings.Repeat("ğ", 80), ""},
		{"81 harf", strings.Repeat("a", 81), fullNameMaxReason},
	}
	for _, tc := range cases {
		input := RegisterInput{Phone: validPhone, Password: "Gizli-Parola-2026", FullName: tc.fullName}
		if problems := input.Check(); problems[FieldFullName] != tc.reason {
			t.Errorf("%s: %q bekleniyordu, %q geldi", tc.name, tc.reason, problems[FieldFullName])
		}
	}
}

func TestChecksReportEveryFieldAtOnce(t *testing.T) {
	problems := (&RegisterInput{Phone: "0532", Password: "kisa", FullName: ""}).Check()

	if len(problems) != 3 {
		t.Errorf("uc alanin hepsi tek seferde bildirilmeli: %v", problems)
	}
}
