package mail

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

// Sahte SMTP sunucusu: surec icinde, isletim sisteminin sectigi portta, tek
// baglanti. Istemcinin gonderdigi her satiri okur (okunmamis veriyle kapanan
// baglanti Linux'ta RST alir; proje kurallari, Test).

var testFrom = mail.Address{Name: "getir", Address: "no-reply@getir.local"}

const (
	testRecipient = "ayse@ornek.com"
	testSubject   = "getir e-posta doğrulama kodun"
)

// delivery, sahte sunucunun aldigi ileti.
type delivery struct {
	from, to string
	data     []byte
}

// fakeSMTP, sunucuyu baslatir; rcptReply RCPT TO'ya verilecek cevaptir.
// greet false ise sunucu baglantiyi kabul edip HIC konusmaz (sure testi).
func fakeSMTP(t *testing.T, rcptReply string, greet bool) (string, <-chan delivery) {
	t.Helper()
	var config net.ListenConfig
	listener, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("dinlenemedi: %v", err)
	}
	deliveries := make(chan delivery, 1)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer func() {
			if err := conn.Close(); err != nil {
				t.Errorf("sahte sunucu baglantisi kapanmadi: %v", err)
			}
		}()
		if !greet {
			// Istemci karsilama bekler, bir sey yazmaz: okunacak veri yok.
			<-t.Context().Done()
			return
		}
		serve(textproto.NewConn(conn), rcptReply, deliveries)
	}()
	t.Cleanup(func() {
		if err := listener.Close(); err != nil {
			t.Errorf("dinleyici kapanmadi: %v", err)
		}
		wg.Wait()
	})
	return listener.Addr().String(), deliveries
}

// serve, tek SMTP konusmasini yurutur. Hata yollarinda konusma biter, istemci
// baglantiyi kapatir.
func serve(text *textproto.Conn, rcptReply string, deliveries chan<- delivery) {
	var got delivery
	reply := func(line string) bool { return text.PrintfLine("%s", line) == nil }
	if !reply("220 sahte ESMTP") {
		return
	}
	for {
		line, err := text.ReadLine()
		if err != nil {
			return
		}
		switch {
		case strings.HasPrefix(line, "EHLO"), strings.HasPrefix(line, "HELO"):
			reply("250 sahte")
		case strings.HasPrefix(line, "MAIL FROM:"):
			got.from = strings.Trim(strings.TrimPrefix(line, "MAIL FROM:"), "<>")
			reply("250 tamam")
		case strings.HasPrefix(line, "RCPT TO:"):
			got.to = strings.Trim(strings.TrimPrefix(line, "RCPT TO:"), "<>")
			reply(rcptReply)
		case line == "DATA":
			reply("354 devam")
			data, err := text.ReadDotBytes()
			if err != nil {
				return
			}
			got.data = data
			reply("250 kuyrukta")
		case line == "QUIT":
			reply("221 hosca kal")
			deliveries <- got
			return
		default:
			reply("250 tamam")
		}
	}
}

func newTestSMTP(t *testing.T, address string, timeout time.Duration) *SMTP {
	t.Helper()
	sender, err := NewSMTP(SMTPOptions{
		Address: address, From: testFrom, Timeout: timeout,
		Now: func() time.Time { return time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("gonderici kurulamadi: %v", err)
	}
	return sender
}

func testMessage() Message {
	return Message{
		To: testRecipient, Subject: testSubject,
		Text: "Doğrulama kodun: 042137\nKod 10 dakika geçerli.",
		HTML: "<p>Doğrulama kodun: <strong>042137</strong></p>",
	}
}

func TestSMTPDeliversMultipartMessage(t *testing.T) {
	address, deliveries := fakeSMTP(t, "250 tamam", true)

	if err := newTestSMTP(t, address, 2*time.Second).Send(t.Context(), testMessage()); err != nil {
		t.Fatalf("gonderilemedi: %v", err)
	}

	got := <-deliveries
	if got.from != testFrom.Address || got.to != testRecipient {
		t.Errorf("zarf: from %q to %q", got.from, got.to)
	}
	message, err := mail.ReadMessage(bytes.NewReader(got.data))
	if err != nil {
		t.Fatalf("ileti okunamadi: %v", err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(message.Header.Get("Subject"))
	if err != nil || subject != testSubject {
		t.Errorf("konu UTF-8 cozulmeli: %q (%v)", subject, err)
	}
	if !strings.HasSuffix(message.Header.Get("Message-ID"), "@getir.local>") {
		t.Errorf("Message-ID gonderenin alan adini tasimali: %q", message.Header.Get("Message-ID"))
	}
	if message.Header.Get("Date") != "Sun, 04 Oct 2026 12:00:00 +0000" {
		t.Errorf("Date saatten gelmeli: %q", message.Header.Get("Date"))
	}

	parts := readParts(t, message)
	want := testMessage()
	if parts["text/plain"] != want.Text || parts["text/html"] != want.HTML {
		t.Errorf("govdeler bozuldu: %+v", parts)
	}
}

// readParts, multipart/alternative govdenin parcalari: tur -> cozulmus metin
// (quoted-printable'i okuyucu acar).
func readParts(t *testing.T, message *mail.Message) map[string]string {
	t.Helper()
	mediaType, params, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/alternative" {
		t.Fatalf("multipart/alternative bekleniyordu: %q (%v)", mediaType, err)
	}
	reader := multipart.NewReader(message.Body, params["boundary"])
	parts := map[string]string{}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return parts
		}
		if err != nil {
			t.Fatalf("parca okunamadi: %v", err)
		}
		body, err := io.ReadAll(part)
		if err != nil {
			t.Fatalf("parca govdesi okunamadi: %v", err)
		}
		kind, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
		if err != nil {
			t.Fatalf("parca turu: %v", err)
		}
		parts[kind] = string(body)
	}
}

func TestSMTPErrorCarriesCodeButNotServerText(t *testing.T) {
	// Sunucunun metni aliciyi yansitir; hata gunluge yazilir, adres oraya girmemeli.
	address, _ := fakeSMTP(t, "550 5.1.1 <"+testRecipient+">: boyle bir kullanici yok", true)

	err := newTestSMTP(t, address, 2*time.Second).Send(t.Context(), testMessage())

	if err == nil {
		t.Fatal("reddedilen alici hata vermeli")
	}
	if strings.Contains(err.Error(), testRecipient) || !strings.Contains(err.Error(), "550") {
		t.Errorf("hata kodu tasimali, adresi tasimamali: %v", err)
	}
}

func TestSMTPGivesUpOnSilentServer(t *testing.T) {
	address, _ := fakeSMTP(t, "", false)
	started := time.Now()

	err := newTestSMTP(t, address, 200*time.Millisecond).Send(t.Context(), testMessage())

	if err == nil {
		t.Fatal("konusmayan sunucu hata vermeli")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Errorf("sure siniri uygulanmadi: %v", elapsed)
	}
}

func TestSMTPHonoursCallerCancellation(t *testing.T) {
	address, _ := fakeSMTP(t, "", false)
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()

	if err := newTestSMTP(t, address, time.Minute).Send(ctx, testMessage()); err == nil {
		t.Fatal("cagiranin suresi dolunca gonderim bitmeli")
	}
}

func TestNewSMTPRejectsAddressWithoutPort(t *testing.T) {
	if _, err := NewSMTP(SMTPOptions{Address: "localhost", From: testFrom, Timeout: time.Second, Now: time.Now}); err == nil {
		t.Fatal("portsuz adres reddedilmeli")
	}
}

func TestEncodeRejectsHeaderInjection(t *testing.T) {
	for _, msg := range []Message{
		{To: "ayse@ornek.com\r\nBcc: x@y.z", Subject: testSubject},
		{To: testRecipient, Subject: "kod\r\nBcc: x@y.z"},
	} {
		if _, err := encode(testFrom, msg, time.Now()); err == nil {
			t.Errorf("satir sonu tasiyan baslik reddedilmeli: %q", msg.To+msg.Subject)
		}
	}
}

func TestMemoryKeepsMessagesInOrder(t *testing.T) {
	box := NewMemory()
	first, second := testMessage(), testMessage()
	second.To = "baska@ornek.com"

	for _, msg := range []Message{first, second} {
		if err := box.Send(t.Context(), msg); err != nil {
			t.Fatalf("bellek kutusu hata vermemeli: %v", err)
		}
	}

	sent := box.Sent()
	if len(sent) != 2 || sent[0].To != testRecipient || sent[1].To != "baska@ornek.com" {
		t.Errorf("sira korunmali: %+v", sent)
	}
	sent[0].To = "degisti"
	if box.Sent()[0].To != testRecipient {
		t.Error("Sent kopya donmeli")
	}
}
