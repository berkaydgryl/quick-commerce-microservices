package content

import "fmt"

// checkPaymentMethods (T11.17, QA O1): kart saklama kosullari en az bir
// paragraf. Bos liste ya da eksik anahtar Go'dan gecerse web'in semasi
// (termsParagraphs .min(1)) BUTUN icerigi reddeder ve her ekran yedek metne
// duser; kural burada da uygulanir. Bos paragrafi checkTexts yakalar.
func checkPaymentMethods(methods PaymentMethods) error {
	if len(methods.TermsParagraphs) == 0 {
		return fmt.Errorf("paymentMethods.termsParagraphs bos, en az 1 paragraf olmali")
	}
	return nil
}
