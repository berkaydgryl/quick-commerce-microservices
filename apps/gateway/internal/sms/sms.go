// Package sms, gateway'in kisa mesaj gonderimidir (T11.14 PR 3; ADR-12 2. eki).
// Bugun tek kullanim telefon numarasi dogrulama kodudur.
//
// GERCEK SMS SAGLAYICISI YOK (bekleyen is #95): gelistirmede mesaj Mailpit'e
// e-posta olarak duser (Mailbox): alici "<numara>@sms.getir.local", konu
// numaranin kendisi; Mailpit arayuzunde e-postalarin yaninda gorunur.
// Production'da numara degistirme uclari hic baglanmaz (config).
package sms

import (
	"context"
	"fmt"
	"html"
	"strings"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
)

// MailboxDomain, gelistirmedeki SMS kutusunun alan adi: alici
// "905321234567@sms.getir.local" olur (numaranin rakamlari).
const MailboxDomain = "sms.getir.local"

// Mailer, iletiyi teslim eder; gercegi mail.SMTP (MOCK'ta mail.Memory).
type Mailer interface {
	Send(ctx context.Context, msg mail.Message) error
}

// Mailbox, SMS'i e-posta olarak gonderen sahte saglayici (yalnizca gelistirme).
type Mailbox struct {
	mailer Mailer
}

// NewMailbox, iletiyi verilen gondericiyle teslim eden kutuyu kurar.
func NewMailbox(mailer Mailer) *Mailbox {
	return &Mailbox{mailer: mailer}
}

// Send, mesaji numaranin kutusuna gonderir. Numara E.164 gelir (+905...);
// adresin yerel parcasi rakamlaridir.
func (b *Mailbox) Send(ctx context.Context, phone, text string) error {
	msg := mail.Message{
		To:      Address(phone),
		Subject: "SMS " + phone,
		Text:    text,
		HTML:    "<p>" + html.EscapeString(text) + "</p>",
	}
	if err := b.mailer.Send(ctx, msg); err != nil {
		return fmt.Errorf("sms kutusuna gonderilemedi: %w", err)
	}
	return nil
}

// Address, numaranin gelistirmedeki kutu adresi: "+905321234567" ->
// "905321234567@sms.getir.local".
func Address(phone string) string {
	return strings.TrimPrefix(phone, "+") + "@" + MailboxDomain
}
