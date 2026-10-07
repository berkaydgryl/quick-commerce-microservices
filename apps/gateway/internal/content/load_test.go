package content

import (
	"net/url"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/assets"
)

const testAssetBase = "https://cdn.example.com/static"

func testResolver(t *testing.T) assets.Resolver {
	t.Helper()
	base, err := url.Parse(testAssetBase)
	if err != nil {
		t.Fatalf("kok adres cozulemedi: %v", err)
	}
	return assets.NewResolver(base)
}

// validJSON, en kucuk gecerli icerik; testler ondan bozuk surumler uretir.
const validJSON = `{
  "header": {"brand": "getir", "service": "market", "loginLabel": "Giriş yap", "registerLabel": "Kayıt ol"},
  "hero": {
    "title": "Kapına gelen market",
    "banner": {"sources": [{"url": "/img/banner/a-960.jpg", "width": 960}], "width": 960, "height": 277}
  },
  "loginCard": {
    "title": "Giriş yap veya kayıt ol", "countryLabel": "Ülke kodu", "phoneLabel": "Telefon Numarası",
    "continueLabel": "Devam Et", "closeLabel": "Kapat",
    "showPasswordLabel": "Şifreyi göster",
    "hidePasswordLabel": "Şifreyi gizle",
    "countries": [{"code": "TR", "name": "Türkiye", "dialCode": "+90", "flagUrl": "/img/flag/tr.svg"}],
    "login": {"passwordLabel": "Şifren", "submitLabel": "Giriş yap", "pendingLabel": "Giriş yapılıyor…",
      "registerPrompt": "Hesabın yok mu?", "registerLinkLabel": "Kayıt ol",
      "unknownPhoneNotice": "Bu numarayla kayıtlı bir hesap yok."},
    "register": {"fullNameLabel": "Adın soyadın", "passwordLabel": "Şifre belirle", "submitLabel": "Kayıt ol",
      "pendingLabel": "Kaydın yapılıyor…", "loginPrompt": "Zaten hesabın var mı?", "loginLinkLabel": "Giriş yap",
      "knownPhoneNotice": "Bu numarayla kayıtlı bir hesap var."},
    "forgotPasswordLabel": "Şifremi unuttum",
    "resetPassword": {"title": "Şifreni yenile", "description": "Telefonunu ve yeni şifreni yaz.", "passwordLabel": "Yeni şifre",
      "submitLabel": "Şifreyi değiştir", "pendingLabel": "Şifren değiştiriliyor…", "loginPrompt": "Şifreni hatırladın mı?",
      "loginLinkLabel": "Giriş yap"}
  },
  "categories": {"title": "Kategoriler"},
  "appDownload": {
    "title": "Getir'i indir!", "subtitle": "İstediğin ürünleri dakikalar içinde kapına getirelim.",
    "image": {"url": "/img/landing/telefonlar.png", "width": 634, "height": 298},
    "stores": [{"label": "App Store'dan indir", "url": "https://apps.apple.com/app/id995280265",
      "badge": {"url": "/img/store/app-store.svg", "width": 160, "height": 48}}]
  },
  "features": [{"image": {"url": "/img/tanitim/teslimat.png", "width": 300, "height": 300}, "text": "Dakikalar içinde kapında!"}],
  "addressSetup": {
    "title": "Teslimat Adresi Ekle", "backLabel": "Geri", "pinHint": "Adresini seçmek için Pin'i sürükle",
    "searchLabel": "Adres ara", "searchPlaceholder": "Sokağını veya posta kodunu arat", "searchSubmitLabel": "Ara",
    "searchEmptyNotice": "Sonuç bulunamadı.", "useAddressLabel": "Bu adresi kullan", "resolvingLabel": "Adres bulunuyor…",
    "unresolvedNotice": "Bu nokta için adres bulunamadı.", "kindLabel": "Adres türü",
    "kinds": [{"kind": "HOME", "label": "Ev", "icon": "🏠"}, {"kind": "WORK", "label": "İş", "icon": "🏢"}],
    "titleLabel": "Başlık", "lineLabel": "Adres", "buildingLabel": "Bina", "floorLabel": "Kat", "apartmentLabel": "Daire",
    "noteLabel": "Adres Tarifi", "saveLabel": "Kaydet", "savingLabel": "Kaydediliyor…", "noMarketNotice": "Hizmet veren market yok.",
    "map": {"tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "© OpenStreetMap katkıcıları",
      "center": {"lat": 40.9885, "lng": 29.027}, "zoom": 15}
  },
  "appHeader": {
    "searchLabel": "Market veya ürün ara", "searchPlaceholder": "Market veya ürün ara", "searchClearLabel": "Aramayı temizle",
    "addressLabel": "Teslimat adresi", "addressListLabel": "Kayıtlı adreslerin",
    "addressBookTitle": "Adreslerim", "addressConfirmLabel": "Adresi Onayla", "addressAddPrompt": "Başka bir adreste misin?",
    "addressAddLabel": "Adres Ekle", "addressLoginLabel": "Adres seçmek için giriş yap",
    "noAddressNotice": "Kayıtlı adresin yok.", "addressLoadingLabel": "Adreslerin yükleniyor…", "profileLabel": "Profil",
    "accountLabel": "Hesabım", "logoutLabel": "Çıkış yap",
    "logoutPendingLabel": "Çıkış yapılıyor…"
  },
  "marketList": {
    "categoriesTitle": "Kategoriler", "allLabel": "Tümü", "countLabel": "işletme listeleniyor",
    "clearFilterLabel": "Filtreyi kaldır", "loadingLabel": "İşletmeler yükleniyor…",
    "emptyNotice": "Bölgende işletme yok.", "filterEmptyNotice": "Bu kategoride işletme yok.",
    "ratingLabel": "Puan", "ratingCountLabel": "değerlendirme", "minBasketLabel": "Min.",
    "freeDeliveryThresholdLabel": "üzeri ücretsiz teslimat", "closedLabel": "Kapalı",
    "storeTypes": [
      {"type": "MARKET", "label": "Market"}, {"type": "MANAV", "label": "Manav"}, {"type": "KASAP", "label": "Kasap"},
      {"type": "SARKUTERI", "label": "Şarküteri"}, {"type": "KURUYEMIS", "label": "Kuruyemiş"},
      {"type": "FIRIN", "label": "Fırın"}, {"type": "PETSHOP", "label": "Pet Shop"}, {"type": "CICEKCI", "label": "Çiçekçi"}
    ],
    "groups": [
      {"label": "Gıda & Market", "imageUrl": "/img/market/market.jpg",
        "types": ["MARKET", "MANAV", "KASAP", "SARKUTERI", "KURUYEMIS", "FIRIN"]},
      {"label": "Diğer", "imageUrl": "/img/market/petshop.jpg", "types": ["PETSHOP", "CICEKCI"]}
    ],
    "cart": {
      "title": "Sepetim", "emptyTitle": "Sepetin şu an boş", "emptyHint": "Sepetine ürün ekle", "itemCountLabel": "ürün",
      "subtotalLabel": "Ara toplam", "deliveryLabel": "Teslimat", "freeDeliveryLabel": "Ücretsiz", "totalLabel": "Toplam",
      "minBasketRemainingLabel": "Minimum sepet tutarına kalan", "goToCartLabel": "Sepete git", "clearLabel": "Sepeti boşalt", "clearConfirmQuestion": "Sepeti boşaltmak istediğine emin misin?", "clearConfirmHint": "Sepetteki bütün ürünler kaldırılır.", "clearConfirmLabel": "Boşalt", "cancelLabel": "Vazgeç", "closeLabel": "Kapat", "decreaseSuffix": "adedini azalt", "increaseSuffix": "adedini artır", "removeSuffix": "sepetten çıkar", "quantitySuffix": "adedi"
    }
  },
  "favorites": {
    "title": "Favori İşletmelerim", "addLabel": "Favorilere ekle", "removeLabel": "Favorilerden çıkar",
    "loadingLabel": "Favorilerin yükleniyor…", "emptyTitle": "Henüz favori işletmen yok", "emptyHint": "Kalbe dokun.",
    "removedNotice": "favorilerden çıkarıldı",
    "updateFailedToast": "Favori güncellenemedi.", "listFullToast": "Favori listen dolu.", "toastDismissLabel": "Kapat"
  },
  "accountMenu": {
    "label": "Hesap menüsü", "profileLabel": "Profilim", "addressesLabel": "Adreslerim",
    "favoritesLabel": "Favori İşletmeler", "ordersLabel": "Geçmiş Siparişlerim",
    "paymentMethodsLabel": "Ödeme Yöntemlerim"
  },
  "paymentMethods": {"title": "Ödeme Yöntemlerim", "loadingLabel": "Kartların yükleniyor…", "addLabel": "Kredi/Banka Kartı", "expiredLabel": "Süresi doldu", "lastFourLabel": "son dört hane", "deleteSuffix": "kartını sil", "confirmTitle": "Kartı sil", "confirmQuestionSuffix": "kartını silmek istiyor musun?", "confirmHint": "Geçmiş siparişlerin bundan etkilenmez.", "confirmLabel": "Sil", "deletingLabel": "Siliniyor…", "cancelLabel": "Vazgeç", "deletedToastSuffix": "kartı silindi.", "closeLabel": "Kapat", "backToListLabel": "Ödeme Yöntemlerim'e geri dön", "addTitle": "Kart Ekle", "securityTitle": "Güvenlik", "securityText": "Kart numaranın tamamını ve CVV'ni saklamıyoruz; yalnızca ilk 4 ve son 4 hane saklanır. Kartını istediğin zaman silebilirsin.", "nicknameLabel": "Karta İsim Ver (Kişisel, İş vb.)", "numberLabel": "Kart Numarası", "numberValidLabel": "Geçerli kart numarası", "holderNameLabel": "Kart Üzerindeki İsim", "expiryLegend": "Kartın Son Kullanma Tarihi:", "monthLabel": "Ay", "yearLabel": "Yıl", "expiryRequiredNotice": "Son kullanma ayını ve yılını seç", "cvvLabel": "CVV", "termsLinkLabel": "Kullanım Koşulları", "termsSuffix": "'nı okudum, kabul ediyorum.", "termsRequiredNotice": "Devam etmek için kullanım koşullarını kabul et", "termsTitle": "Kart saklama koşulları", "termsParagraphs": ["Kart numaranın tamamı ve CVV saklanmaz. Kartının yalnızca ilk 4 ve son 4 hanesi, markası, son kullanma tarihi ve üzerindeki isim saklanır.", "Kartın kaydedilmeden önce ödeme sağlayıcısında 0 TL tutarında doğrulanır; bu doğrulama hesabından para çekmez.", "Bir hesapta en fazla 10 kart kayıtlı olabilir. Kayıtlı kartlarını Ödeme Yöntemlerim'den istediğin zaman silebilirsin.", "Son kullanma tarihi geçen kart listede kalır ama ödemede kullanılmaz."], "saveLabel": "Devam", "savingLabel": "Kaydediliyor…", "retryWaitLabel": "Yeniden deneyebilmen için", "duplicateCardNotice": "Bu kart zaten kayıtlı.", "addedToastPrefix": "Kart eklendi:", "acceptedBrandsLabel": "Kabul edilen kartlar", "holderCaption": "KART SAHİBİ", "expiryCaption": "SKT", "holderPlaceholder": "AD SOYAD", "expiryPlaceholder": "AA/YY", "nicknamePlaceholder": "Kartım", "cvvCaption": "CVV", "cvvNote": "CVV yalnızca doğrulama için kullanılır, saklanmaz.", "brandLabels": {"VISA": "Visa", "MASTERCARD": "Mastercard", "AMEX": "Amex", "TROY": "Troy"}, "brandMarks": {"VISA": "VISA", "MASTERCARD": "MC", "AMEX": "AMEX", "TROY": "troy"}},
  "marketPage": {"infoLabel": "İşletme bilgisi", "loadingLabel": "İşletme yükleniyor…", "openLabel": "Açık", "aboutLabel": "Hakkında", "closeLabel": "Kapat", "brandLabel": "Marka", "deliveryTimeLabel": "Teslimat süresi", "minBasketLabel": "Minimum sepet tutarı", "deliveryFeeLabel": "Teslimat ücreti", "freeDeliveryThresholdLabel": "Ücretsiz teslimat eşiği", "searchLabel": "Bu işletmede ara", "searchPlaceholder": "Bu işletmede ara…", "allProductsTitle": "Tüm Ürünler", "searchResultsTitle": "Arama Sonuçları", "searchEmptyNotice": "Bu işletmede aradığın ürün bulunmuyor.", "categoryEmptyNotice": "Bu kategoride ürün yok.", "productsLoadingLabel": "Ürünler yükleniyor…", "moreLabel": "Daha fazla ürün", "loadingMoreLabel": "Yükleniyor…", "addSuffix": "sepete ekle", "soldOutLabel": "Tükendi", "unavailableLabel": "Satışta değil", "lowStockPrefix": "Son", "lowStockSuffix": "adet"},
  "cartPage": {"title": "Sepetim", "clearLabel": "Sepeti temizle", "addressTitle": "Adres", "addressLoadingLabel": "Adresin yükleniyor…", "noAddressNotice": "Kayıtlı adresin yok; üstteki adres düğmesinden ekleyebilirsin.", "totalsTitle": "Sepet Toplamı", "subtotalLabel": "Sepet Tutarı", "freeDeliveryRemainingLabel": "Ücretsiz teslimata kalan", "checkoutLabel": "Ödemeye Geç", "deliveryTimeShortLabel": "TVS", "deliveryTimeLabel": "Tahmini varış süresi", "browseMarketsLabel": "Marketlere göz at"},
  "footer": {"copyright": "© 2026 getir"},
  "checkout": {"title": "Ödeme", "giftTitle": "Hediye Bilgileri", "giftToggleLabel": "Hediye olarak gönder", "giftYesLabel": "Evet", "giftNoLabel": "Hayır", "giftInfoLabel": "Hediye bilgisi", "giftInfoText": "Hediye notu ve alıcı bilgileri siparişle birlikte teslimata iletilir.", "presetNoteLabel": "Hazır Not Ekle", "presetNotesTitle": "Hazır Notlar", "presetNotes": ["İyi ki doğdun! Nice mutlu yıllara.", "Geçmiş olsun, en kısa zamanda iyileşmeni dilerim.", "Tebrikler! Başarılarının devamını dilerim.", "Seni düşündüm, afiyet olsun."], "giftMessageLabel": "Hediye Kartı Notu", "senderNameLabel": "Göndericinin Adı", "recipientNameLabel": "Alıcının Adı", "recipientPhoneLabel": "Alıcının Telefon Numarası", "deliveryTitle": "Teslimat Yöntemi", "deliveryFeeLabel": "Teslimat ücreti", "freeDeliveryLabel": "Ücretsiz Teslimat", "noteTitle": "Not Ekle", "noteLabel": "Sipariş notu", "notePlaceholder": "Sipariş notunu buraya yazabilirsin.", "doNotRingLabel": "Zili Çalma", "paymentTitle": "Ödeme Yöntemi", "changeLabel": "Değiştir", "addCardLabel": "Kart ekle", "cardsLoadingLabel": "Kartların yükleniyor…", "noCardNotice": "Kayıtlı kartın yok.", "securityNote": "Kart numaranın tamamını ve CVV'ni saklamıyoruz; ödeme kayıtlı kartınla alınır.", "summaryTitle": "Ödeme Özeti", "subtotalLabel": "Sepet Tutarı", "deliveryFeeRowLabel": "Teslimat Ücreti", "freeLabel": "Ücretsiz", "payableLabel": "Ödenecek Tutar", "preInfoLinkLabel": "Ön Bilgilendirme Formu", "agreementJoiner": "ve", "distanceSalesLinkLabel": "Mesafeli Satış Sözleşmesi", "agreementSuffix": "'ni okudum, kabul ediyorum.", "preInfoParagraphs": ["Bu bir demo uygulamasıdır: Ön Bilgilendirme Formu metni henüz eklenmedi.", "Gerçek metin eklendiğinde bu pencerede gösterilecek."], "distanceSalesParagraphs": ["Bu bir demo uygulamasıdır: Mesafeli Satış Sözleşmesi metni henüz eklenmedi.", "Gerçek metin eklendiğinde bu pencerede gösterilecek."], "closeLabel": "Kapat", "placeOrderLabel": "Sipariş Ver", "placingLabel": "Sipariş veriliyor…", "orderPlacedToast": "Siparişin alındı.", "orderInReviewToast": "Siparişin inceleniyor; durumunu Geçmiş Siparişlerim'den izleyebilirsin.", "blockerGiftNotice": "Sipariş vermek için hediye bilgilerini tamamla.", "blockerAgreementNotice": "Sipariş vermek için sözleşmeleri onayla.", "blockerCardNotice": "Sipariş vermek için bir kart seç.", "blockerAddressNotice": "Sipariş vermek için bir teslimat adresi ekle.", "blockerMinBasketNotice": "Sepet tutarı minimum sepet tutarının altında.", "blockerClosedNotice": "İşletme şu an kapalı.", "threeDsTitle": "3D Secure Doğrulama", "threeDsDescription": "Bankanın telefonuna gönderdiği 6 haneli doğrulama kodunu gir.", "threeDsCodeLabel": "Doğrulama kodu", "threeDsSubmitLabel": "Onayla", "threeDsSubmittingLabel": "Doğrulanıyor…", "threeDsCancelLabel": "Vazgeç", "threeDsRemainingLabel": "Kalan süre", "threeDsLastSecondsNotice": "Son 30 saniye", "threeDsAttemptsLeftSuffix": "deneme hakkın kaldı", "threeDsExpiredToast": "Doğrulama süresi doldu; siparişini yeniden verebilirsin.", "threeDsCancelledToast": "Ödeme yapılmadı; siparişini yeniden verebilirsin.", "methodDialogTitle": "Ödeme Yöntemi Seç", "onlinePaymentTitle": "Online Ödeme", "deleteCardLabel": "Kartı Sil", "chooseLabel": "Seç", "backLabel": "Geri", "cardMissingNotice": "Bu kart artık kayıtlı değil, başka kart seç.", "reservationHeldPrefix": "Ürünlerin", "reservationHeldSuffix": "boyunca senin için ayrıldı.", "reservationPendingLabel": "Ürünlerin ayrılıyor…", "reservationLastMinuteNotice": "Son 1 dakika", "reservationRenewedToast": "Ürünlerin yeniden senin için ayrıldı.", "reservationRetryLabel": "Tekrar dene", "blockerReservationNotice": "Ürünlerin ayrılamadı; sepetini kontrol et."},
  "profile": {
    "phoneLabel": "Telefon", "emailLabel": "E-posta", "addEmailLabel": "E-posta ekle",
    "editProfileLabel": "Profili düzenle", "verifiedLabel": "Doğrulandı", "verifyPhoneLabel": "Doğrula", "loadingLabel": "Yükleniyor",
    "editDialog": {
      "title": "Profili düzenle", "closeLabel": "Kapat", "backLabel": "Geri", "nameLabel": "Ad soyad", "saveNameLabel": "Kaydet",
      "savingNameLabel": "Kaydediliyor", "nameSavedToast": "Güncellendi.", "emailLabel": "E-posta", "phoneLabel": "Telefon",
      "emptyEmailLabel": "Yok", "changeLabel": "Değiştir", "addLabel": "Ekle", "verifyLabel": "Doğrula"
    },
    "phoneDialog": {
      "title": "Telefon", "changeDescription": "Şifreni gir.", "verifyDescription": "Kod göndereceğiz.", "phoneFieldLabel": "Numara",
      "passwordLabel": "Şifre", "showPasswordLabel": "Göster", "hidePasswordLabel": "Gizle", "sendLabel": "Gönder", "sendingLabel": "Gönderiliyor",
      "codeSentToLabel": "Şu numaraya:", "codeFieldLabel": "Kod", "verifyLabel": "Doğrula", "verifyingLabel": "Doğrulanıyor",
      "expiresInLabel": "Geçerlilik", "expiredNotice": "Süre doldu.", "resendLabel": "Yeniden gönder", "resendWaitLabel": "Bekle",
      "changePhoneLabel": "Başka numara", "verifiedToast": "Doğrulandı.", "changedToast": "Değişti."
    },
    "emailDialog": {
      "title": "E-posta adresi", "closeLabel": "Kapat", "emailDescription": "Kod göndereceğiz.",
      "emailFieldLabel": "E-posta adresi", "sendLabel": "Kod gönder", "sendingLabel": "Gönderiliyor",
      "codeSentToLabel": "Şu adrese gönderdik:", "codeFieldLabel": "Doğrulama kodu", "verifyLabel": "Doğrula",
      "verifyingLabel": "Doğrulanıyor", "expiresInLabel": "Geçerlilik", "expiredNotice": "Süre doldu.",
      "resendLabel": "Yeniden gönder", "resendWaitLabel": "Bekle", "changeEmailLabel": "Değiştir",
      "verifiedToast": "Doğrulandı."
    }
  },
  "addresses": {
    "title": "Adreslerim", "loadingLabel": "Yükleniyor", "emptyNotice": "Adres yok.", "selectedLabel": "Seçili",
    "editSuffix": "adresini düzenle", "deleteSuffix": "adresini sil",
    "addOptions": [{ "kind": "HOME", "label": "Ev adresi ekle" }],
    "editTitle": "Adresi Düzenle", "deleteLabel": "Adresi sil", "confirmTitle": "Adresi sil",
    "confirmQuestionSuffix": "adresini silmek istiyor musun?", "confirmHint": "Siparişler etkilenmez.",
    "confirmLabel": "Sil", "deletingLabel": "Siliniyor", "cancelLabel": "Vazgeç",
    "deletedToastSuffix": "adresi silindi.", "updatedToast": "Güncellendi."
  },
  "orders": {
    "title": "Siparişler", "loadingLabel": "Yükleniyor", "emptyNotice": "Sipariş yok.", "unknownMarketLabel": "Market",
    "completedLabel": "Tamamlandı", "inProgressLabel": "Devam ediyor", "cancelledLabel": "İptal", "refundedLabel": "İade",
    "notDeliveredLabel": "Teslim edilmedi", "moreLabel": "Daha fazla", "loadingMoreLabel": "Yükleniyor",
    "dateLabel": "Tarih", "addressLabel": "Adres", "itemsTitle": "Ürünler", "subtotalLabel": "Ara toplam",
    "deliveryFeeLabel": "Teslimat", "freeDeliveryLabel": "Ücretsiz", "discountLabel": "İndirim", "totalLabel": "Toplam"
  }
}`

func TestEmbeddedWelcomeLoads(t *testing.T) {
	// Gomulu dosya her derlemede gecerli olmali: bozulursa gateway acilmaz.
	welcome, err := LoadWelcome(testResolver(t))
	if err != nil {
		t.Fatalf("gomulu icerik yuklenemedi: %v", err)
	}
	for _, source := range welcome.Hero.Banner.Sources {
		if !strings.HasPrefix(source.URL, testAssetBase+"/img/banner/") {
			t.Errorf("banner adresi kokun altinda olmali: %q", source.URL)
		}
	}
	if got := welcome.LoginCard.Countries[0].FlagURL; got != testAssetBase+"/img/flag/tr.svg" {
		t.Errorf("bayrak adresi: %q", got)
	}
	// Tanitim bolumleri (T11.7): gorseller kokun altinda, magaza baglantisi
	// disari giden adres oldugu gibi.
	if got := welcome.AppDownload.Image.URL; got != testAssetBase+"/img/landing/telefonlar.png" {
		t.Errorf("telefon gorseli: %q", got)
	}
	for _, store := range welcome.AppDownload.Stores {
		if !strings.HasPrefix(store.Badge.URL, testAssetBase+"/img/store/") || !strings.HasPrefix(store.URL, "https://") {
			t.Errorf("magaza rozeti kokun altinda, baglanti https olmali: %+v", store)
		}
	}
	if len(welcome.Features) != 3 {
		t.Errorf("uc tanitim kutusu bekleniyordu: %d", len(welcome.Features))
	}
	// Market listesi (T11.12): grup gorselleri kokun altinda; her tur tam bir grupta (validate).
	for _, group := range welcome.MarketList.Groups {
		if !strings.HasPrefix(group.ImageURL, testAssetBase+"/img/market/") {
			t.Errorf("grup gorseli kokun altinda olmali: %+v", group)
		}
	}
	if len(welcome.MarketList.StoreTypes) != len(storeTypes) {
		t.Errorf("her dukkan turunun adi olmali: %d", len(welcome.MarketList.StoreTypes))
	}
	// Adres penceresi (T11.8): uc tur, karo adresi disari giden adres oldugu gibi.
	if setup := welcome.AddressSetup; len(setup.Kinds) != 3 || setup.Map.TileURL != "https://tile.openstreetmap.org/{z}/{x}/{y}.png" {
		t.Errorf("adres penceresi: %d tur, karo %q", len(setup.Kinds), setup.Map.TileURL)
	}
}

func TestParseKeepsStoreLinkAsIs(t *testing.T) {
	// Magaza baglantisi ASSET_BASE_URL ile cozulmez: disari giden adrestir.
	welcome, err := parseWelcome([]byte(validJSON), testResolver(t))
	if err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
	if got := welcome.AppDownload.Stores[0].URL; got != "https://apps.apple.com/app/id995280265" {
		t.Errorf("magaza baglantisi degismemeli: %q", got)
	}
	if got := welcome.Features[0].Image.URL; got != testAssetBase+"/img/tanitim/teslimat.png" {
		t.Errorf("kutu gorseli: %q", got)
	}
}

func TestParseResolvesImagesWithoutTouchingTexts(t *testing.T) {
	welcome, err := parseWelcome([]byte(validJSON), testResolver(t))
	if err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
	if got := welcome.Hero.Banner.Sources[0].URL; got != testAssetBase+"/img/banner/a-960.jpg" {
		t.Errorf("banner adresi: %q", got)
	}
	if got := welcome.MarketList.Groups[1].ImageURL; got != testAssetBase+"/img/market/petshop.jpg" {
		t.Errorf("grup gorseli: %q", got)
	}
	if welcome.Hero.Title != "Kapına gelen market" || welcome.LoginCard.Login.PendingLabel != "Giriş yapılıyor…" {
		t.Errorf("metinler oldugu gibi kalmali: %+v", welcome)
	}
}

func TestParseRejectsUnknownField(t *testing.T) {
	// Yazim hatali alan adi ("tilte") sessizce bos baslik olmasin.
	raw := strings.Replace(validJSON, `"categories": {"title"`, `"categories": {"tilte"`, 1)
	if _, err := parseWelcome([]byte(raw), testResolver(t)); err == nil || !strings.Contains(err.Error(), "tilte") {
		t.Fatalf("bilinmeyen alan reddedilmeliydi: %v", err)
	}
}

func TestParseRejectsTrailingContent(t *testing.T) {
	if _, err := parseWelcome([]byte(validJSON+`{}`), testResolver(t)); err == nil {
		t.Fatal("dosyanin sonundaki fazlalik reddedilmeliydi")
	}
}

func TestParseRejectsMissingText(t *testing.T) {
	// Alan hic yazilmazsa bos metin olur; dogrulama alanin yolunu soyler.
	raw := strings.Replace(validJSON, `"pendingLabel": "Giriş yapılıyor…",`, ``, 1)
	_, err := parseWelcome([]byte(raw), testResolver(t))
	if err == nil || !strings.Contains(err.Error(), "loginCard.login.pendingLabel bos") {
		t.Fatalf("eksik metin alanin yoluyla bildirilmeliydi: %v", err)
	}
}

func TestParseRejectsUnresolvableImage(t *testing.T) {
	// http(s) disi sema istemciye gitmez (assets.Resolver ""); icerik acilmaz.
	raw := strings.Replace(validJSON, `"/img/flag/tr.svg"`, `"javascript:alert(1)"`, 1)
	_, err := parseWelcome([]byte(raw), testResolver(t))
	if err == nil || !strings.Contains(err.Error(), "loginCard.countries[0].flagUrl") {
		t.Fatalf("cozulemeyen gorsel reddedilmeliydi: %v", err)
	}
}

func TestStaticReturnsLoadedWelcome(t *testing.T) {
	welcome, err := parseWelcome([]byte(validJSON), testResolver(t))
	if err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
	got, err := NewStatic(welcome).Welcome(t.Context())
	if err != nil {
		t.Fatalf("kaynak hata dondu: %v", err)
	}
	if got.Header.Brand != "getir" || len(got.LoginCard.Countries) != 1 {
		t.Errorf("yuklenen icerik donmeli: %+v", got)
	}
}
