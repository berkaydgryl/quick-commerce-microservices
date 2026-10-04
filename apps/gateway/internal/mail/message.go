// Package mail, gateway'in e-posta gonderimidir (T11.14): iletinin MIME
// bicimi (message.go), SMTP ile teslim (smtp.go) ve MOCK/test icin bellek
// kutusu (memory.go). Iletinin ICERIGINI bilmez; onu kullanan paket (bugun
// emailverify) kurar.
//
// Gelistirmede SMTP sunucusu Mailpit'tir (compose, localhost:1025; arayuz
// localhost:8025). Sifreli baglanti (TLS) ve kimlik dogrulama bugun yok:
// production SMTP'si bekleyen is #90.
package mail

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"strings"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Message, gonderilecek e-posta: tek alici, duz metin ve HTML govde (ikisi
// birden: HTML gostermeyen istemci duz metni okur).
type Message struct {
	// To, alicinin adresi (dogrulanmis bicimde; satir sonu tasiyamaz).
	To      string
	Subject string
	Text    string
	HTML    string
}

// messageIDBytes, Message-ID'nin rastgele parcasi (128 bit).
const messageIDBytes = 16

// encode, iletiyi RFC 5322 + MIME baytlarina cevirir: UTF-8, konu RFC 2047 ile
// kodlu, govdeler quoted-printable, multipart/alternative (once duz metin,
// sonra HTML: istemci son anladigini gosterir).
func encode(from mail.Address, msg Message, now time.Time) ([]byte, error) {
	if strings.ContainsAny(msg.To, "\r\n") || strings.ContainsAny(msg.Subject, "\r\n") {
		// Baslik enjeksiyonu: alici dogrulanmis gelir, bu ikinci kilittir.
		return nil, fmt.Errorf("e-posta basligi satir sonu iceremez")
	}
	messageID := newMessageID(from.Address)

	var body bytes.Buffer
	parts := multipart.NewWriter(&body)
	if err := writePart(parts, "text/plain; charset=utf-8", msg.Text); err != nil {
		return nil, err
	}
	if err := writePart(parts, "text/html; charset=utf-8", msg.HTML); err != nil {
		return nil, err
	}
	if err := parts.Close(); err != nil {
		return nil, fmt.Errorf("ileti govdesi kapatilamadi: %w", err)
	}

	var out bytes.Buffer
	headers := [][2]string{
		{"From", from.String()},
		{"To", (&mail.Address{Address: msg.To}).String()},
		{"Subject", mime.QEncoding.Encode("utf-8", msg.Subject)},
		{"Date", now.Format(time.RFC1123Z)},
		{"Message-ID", messageID},
		{"MIME-Version", "1.0"},
		{"Content-Type", "multipart/alternative; boundary=" + parts.Boundary()},
	}
	for _, header := range headers {
		fmt.Fprintf(&out, "%s: %s\r\n", header[0], header[1])
	}
	out.WriteString("\r\n")
	out.Write(body.Bytes())
	return out.Bytes(), nil
}

// writePart, tek govde parcasini quoted-printable yazar.
func writePart(parts *multipart.Writer, contentType, text string) error {
	header := textproto.MIMEHeader{}
	header.Set("Content-Type", contentType)
	header.Set("Content-Transfer-Encoding", "quoted-printable")
	part, err := parts.CreatePart(header)
	if err != nil {
		return fmt.Errorf("ileti parcasi acilamadi: %w", err)
	}
	encoder := quotedprintable.NewWriter(part)
	if _, err := encoder.Write([]byte(text)); err != nil {
		return fmt.Errorf("ileti parcasi yazilamadi: %w", err)
	}
	if err := encoder.Close(); err != nil {
		return fmt.Errorf("ileti parcasi kapatilamadi: %w", err)
	}
	return nil
}

// newMessageID, <rastgele@gonderen-alani>: alan adi gonderenin adresinden.
func newMessageID(sender string) string {
	domain := sender[strings.LastIndex(sender, "@")+1:]
	return "<" + hex.EncodeToString(ids.RandomBytes(messageIDBytes)) + "@" + domain + ">"
}
