package mail

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"time"
)

// SMTPOptions, SMTP gondericisinin ayarlari (config: SMTP_URL, MAIL_FROM,
// SMTP_TIMEOUT_MS).
type SMTPOptions struct {
	// Address, sunucunun host:port'u (Mailpit: localhost:1025).
	Address string
	// From, gonderen ("getir <no-reply@getir.local>").
	From mail.Address
	// Timeout, tek iletinin ust siniri: baglanti, karsilama ve teslim.
	Timeout time.Duration
	// Now, Date basligi icin saat.
	Now func() time.Time
}

// SMTP, iletiyi standart kutuphanenin net/smtp istemcisiyle teslim eder
// (yeni bagimlilik yok). Her ileti icin ayri baglanti: dogrulama kodu seyrek
// gider, havuz tutmaya degmez.
type SMTP struct {
	address string
	host    string
	from    mail.Address
	timeout time.Duration
	now     func() time.Time
}

// NewSMTP, gondericiyi kurar; Address host:port degilse hata.
func NewSMTP(options SMTPOptions) (*SMTP, error) {
	host, _, err := net.SplitHostPort(options.Address)
	if err != nil {
		return nil, fmt.Errorf("smtp adresi host:port olmali: %w", err)
	}
	return &SMTP{address: options.Address, host: host, from: options.From, timeout: options.Timeout, now: options.Now}, nil
}

// Send, iletiyi teslim eder. Sure baglamin ve Timeout'un kisa olanidir;
// asilirsa baglanti kesilir ve hata doner (gorutin birakilmaz).
//
// Hata metni SUNUCUNUN CEVAP METNINI TASIMAZ: metin aliciyi yansitabilir
// ("550 <ad@ornek.com>: no such user") ve hata gunluge yazilir (kisisel veri
// gunluge girmez). Yalnizca adim ve SMTP kodu kalir.
func (s *SMTP) Send(ctx context.Context, msg Message) error {
	body, err := encode(s.from, msg, s.now())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", s.address)
	if err != nil {
		return fmt.Errorf("smtp baglantisi: %w", err)
	}
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return errors.Join(fmt.Errorf("smtp suresi kurulamadi: %w", err), conn.Close())
	}
	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		return errors.Join(redact("karsilama", err), conn.Close())
	}
	if err := s.deliver(client, msg.To, body); err != nil {
		return errors.Join(err, client.Close())
	}
	return nil
}

// deliver, tek iletinin SMTP konusmasi: MAIL, RCPT, DATA, QUIT. Basarida
// QUIT baglantiyi kapatir.
func (s *SMTP) deliver(client *smtp.Client, to string, body []byte) error {
	if err := client.Mail(s.from.Address); err != nil {
		return redact("MAIL", err)
	}
	if err := client.Rcpt(to); err != nil {
		return redact("RCPT", err)
	}
	writer, err := client.Data()
	if err != nil {
		return redact("DATA", err)
	}
	if _, err := writer.Write(body); err != nil {
		return redact("DATA yazimi", err)
	}
	if err := writer.Close(); err != nil {
		return redact("DATA sonu", err)
	}
	if err := client.Quit(); err != nil {
		return redact("QUIT", err)
	}
	return nil
}

// redact, SMTP cevabinin metnini atar, adimi ve kodu birakir. Ag hatasi
// (baglanti koptu, sure doldu) oldugu gibi sarmalanir: alici tasimaz.
func redact(step string, err error) error {
	var reply *textproto.Error
	if errors.As(err, &reply) {
		return fmt.Errorf("smtp %s: sunucu %d kodu dondu", step, reply.Code)
	}
	return fmt.Errorf("smtp %s: %w", step, err)
}
