package sms

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
)

func TestMailboxSendsToNumberAddress(t *testing.T) {
	box := mail.NewMemory()

	if err := NewMailbox(box).Send(t.Context(), "+905321234567", "getir doğrulama kodun: 042137 <b>"); err != nil {
		t.Fatalf("gonderilemedi: %v", err)
	}

	sent := box.Sent()
	if len(sent) != 1 || sent[0].To != "905321234567@sms.getir.local" || sent[0].Subject != "SMS +905321234567" {
		t.Fatalf("alici ve konu: %+v", sent)
	}
	if !strings.Contains(sent[0].Text, "042137") || strings.Contains(sent[0].HTML, "<b>") {
		t.Errorf("metin aynen, HTML kacislanmis olmali: %+v", sent[0])
	}
}

type failingMailer struct{}

func (failingMailer) Send(context.Context, mail.Message) error { return errors.New("smtp kapali") }

func TestMailboxWrapsDeliveryError(t *testing.T) {
	err := NewMailbox(failingMailer{}).Send(t.Context(), "+905321234567", "kod")
	if err == nil || !strings.Contains(err.Error(), "smtp kapali") {
		t.Errorf("teslim hatasi sarmalanmali: %v", err)
	}
}
