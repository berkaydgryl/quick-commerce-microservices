package ids

import (
	"strings"
	"testing"
)

func TestNewMatchesContractFormat(t *testing.T) {
	for _, prefix := range []string{Request, User, Session, Device, Address, Card} {
		id := New(prefix)
		if !Valid(prefix, id) {
			t.Errorf("%s: uretilen kimlik bicim disi: %q", prefix, id)
		}
	}
}

func TestNewIsUnique(t *testing.T) {
	const samples = 200
	seen := make(map[string]struct{}, samples)
	for range samples {
		id := New(User)
		if _, repeated := seen[id]; repeated {
			t.Fatalf("ayni kimlik iki kez uretildi: %q", id)
		}
		seen[id] = struct{}{}
	}
}

func TestValidRejectsForeignValues(t *testing.T) {
	good := "usr_0123456789abcdef0123456789abcdef"
	cases := map[string]string{
		"baska onek":        "ses_0123456789abcdef0123456789abcdef",
		"buyuk harf":        strings.ToUpper(good),
		"kisa":              good[:len(good)-1],
		"uzun":              good + "0",
		"onaltilik degil":   "usr_0123456789abcdef0123456789abcdeg",
		"alt cizgi yok":     "usr0123456789abcdef0123456789abcdef",
		"eski demo kimligi": "usr_ali",
		"bos":               "",
	}
	if !Valid(User, good) {
		t.Fatalf("gecerli kimlik reddedildi: %q", good)
	}
	for name, value := range cases {
		if Valid(User, value) {
			t.Errorf("%s: kabul edilmemeliydi: %q", name, value)
		}
	}
}
