package content

import (
	"errors"
	"fmt"
)

// checkCheckout (T17.1): hazir notlar ve iki sozlesmenin paragraflari en az
// birer tane. Bos liste Go'dan gecerse web'in semasi (.min(1)) BUTUN icerigi
// reddeder ve her ekran yedek metne duser; kural burada da uygulanir. Bos
// metni checkTexts yakalar.
func checkCheckout(checkout Checkout) error {
	problems := make([]error, 0, 3)
	for name, list := range map[string][]string{
		"presetNotes":             checkout.PresetNotes,
		"preInfoParagraphs":       checkout.PreInfoParagraphs,
		"distanceSalesParagraphs": checkout.DistanceSalesParagraphs,
	} {
		if len(list) == 0 {
			problems = append(problems, fmt.Errorf("checkout.%s bos, en az 1 metin olmali", name))
		}
	}
	return errors.Join(problems...)
}
