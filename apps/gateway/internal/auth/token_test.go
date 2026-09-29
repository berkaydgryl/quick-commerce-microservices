package auth

import (
	"encoding/base64"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testUserID    = "usr_0123456789abcdef0123456789abcdef"
	testSessionID = "ses_0123456789abcdef0123456789abcdef"
)

var (
	testSecret   = []byte("yalnizca-test-icin-imza-sirri-32-bayttan-uzun")
	testNow      = time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	testIdentity = Identity{UserID: testUserID, SessionID: testSessionID}
)

// clockAt, sabit saat.
func clockAt(at time.Time) func() time.Time {
	return func() time.Time { return at }
}

func TestIssuedTokenVerifies(t *testing.T) {
	tokens := NewTokens(testSecret, time.Hour, clockAt(testNow))

	token, err := tokens.Issue(testIdentity)
	if err != nil {
		t.Fatalf("jeton uretilemedi: %v", err)
	}
	identity, err := tokens.Verify(token)

	if err != nil || identity != testIdentity {
		t.Errorf("kimlik geri alinmali: %+v %v", identity, err)
	}
	if tokens.TTL() != time.Hour {
		t.Errorf("omur %v olmali", tokens.TTL())
	}
}

func TestTokenCarriesOnlyIdentityClaims(t *testing.T) {
	// JWT imzalidir, SIFRELI DEGILDIR: govdeyi herkes okur. Telefon ya da ad
	// gibi kisisel veri jetona girmemeli.
	token, err := NewTokens(testSecret, time.Hour, clockAt(testNow)).Issue(testIdentity)
	if err != nil {
		t.Fatalf("jeton uretilemedi: %v", err)
	}
	parts := strings.Split(token, ".")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("govde cozulemedi: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("govde JSON degil: %v", err)
	}
	names := make([]string, 0, len(claims))
	for name := range claims {
		names = append(names, name)
	}
	slices.Sort(names)

	if !slices.Equal(names, []string{"exp", "iat", "iss", "sid", "sub"}) {
		t.Errorf("yalnizca kimlik alanlari beklenirdi: %v", names)
	}
	if claims["exp"].(float64)-claims["iat"].(float64) != time.Hour.Seconds() {
		t.Errorf("exp - iat omre esit olmali: %v", claims)
	}
}

func TestVerifyRejectsForgedAndStaleTokens(t *testing.T) {
	verifier := NewTokens(testSecret, time.Hour, clockAt(testNow))
	validClaims := func() accessClaims {
		return accessClaims{
			SessionID: testSessionID,
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    tokenIssuer,
				Subject:   testUserID,
				IssuedAt:  jwt.NewNumericDate(testNow),
				ExpiresAt: jwt.NewNumericDate(testNow.Add(time.Hour)),
			},
		}
	}
	sign := func(method jwt.SigningMethod, key any, claims accessClaims) string {
		t.Helper()
		token, err := jwt.NewWithClaims(method, claims).SignedString(key)
		if err != nil {
			t.Fatalf("jeton imzalanamadi: %v", err)
		}
		return token
	}
	issueAt := func(at time.Time) string {
		t.Helper()
		token, err := NewTokens(testSecret, time.Hour, clockAt(at)).Issue(testIdentity)
		if err != nil {
			t.Fatalf("jeton uretilemedi: %v", err)
		}
		return token
	}
	withClaims := func(change func(*accessClaims)) string {
		claims := validClaims()
		change(&claims)
		return sign(jwt.SigningMethodHS256, testSecret, claims)
	}

	cases := map[string]string{
		"suresi dolmus":           issueAt(testNow.Add(-2 * time.Hour)),
		"gelecekte uretilmis":     issueAt(testNow.Add(time.Hour)),
		"baska sirla imzali":      sign(jwt.SigningMethodHS256, []byte("baska-bir-sistemin-imza-sirri-32-bayttan-uzun"), validClaims()),
		"alg none":                sign(jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, validClaims()),
		"baska algoritma (HS512)": sign(jwt.SigningMethodHS512, testSecret, validClaims()),
		"baska verici":            withClaims(func(c *accessClaims) { c.Issuer = "baska-sistem" }),
		"bitis alani yok":         withClaims(func(c *accessClaims) { c.ExpiresAt = nil }),
		"kullanici bicim disi":    withClaims(func(c *accessClaims) { c.Subject = "usr_1" }),
		"oturum yok":              withClaims(func(c *accessClaims) { c.SessionID = "" }),
		"bicimsiz":                "bozuk.jeton.degeri",
		"bos":                     "",
	}
	for name, token := range cases {
		if identity, err := verifier.Verify(token); err == nil {
			t.Errorf("%s: jeton reddedilmeliydi, kimlik %+v dondu", name, identity)
		}
	}
}
