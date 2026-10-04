package emailverify

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	texttemplate "text/template"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
)

// codeSubject, iletinin konusu. Kod konuya YAZILMAZ: bildirimde ve kilit
// ekraninda gorunmesin.
const codeSubject = "getir e-posta doğrulama kodun"

// Sablonlar gomuludur (internal/content'teki icerik dosyasi gibi): bozuk
// sablon gateway'i acilista durdurur (template.Must), ilk istekte degil.
// HTML sablonu html/template ile islenir: ad soyad kacislanir.
//
//go:embed templates/code.txt.tmpl templates/code.html.tmpl
var templates embed.FS

var (
	textTemplate = texttemplate.Must(texttemplate.ParseFS(templates, "templates/code.txt.tmpl"))
	htmlTemplate = htmltemplate.Must(htmltemplate.ParseFS(templates, "templates/code.html.tmpl"))
)

// codeMessageData, sablonlarin verisi.
type codeMessageData struct {
	FullName     string
	Code         string
	ValidMinutes int
}

// codeMessage, kodu tasiyan ileti.
func codeMessage(to, fullName, code string) (mail.Message, error) {
	data := codeMessageData{FullName: fullName, Code: code, ValidMinutes: int(CodeTTL.Minutes())}
	var text, html bytes.Buffer
	if err := textTemplate.Execute(&text, data); err != nil {
		return mail.Message{}, fmt.Errorf("ileti metni kurulamadi: %w", err)
	}
	if err := htmlTemplate.Execute(&html, data); err != nil {
		return mail.Message{}, fmt.Errorf("ileti HTML'i kurulamadi: %w", err)
	}
	return mail.Message{To: to, Subject: codeSubject, Text: text.String(), HTML: html.String()}, nil
}
