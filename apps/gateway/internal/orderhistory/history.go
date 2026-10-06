// Package orderhistory, Gecmis Siparislerim'in gateway tarafidir (T11.16).
//
// order-service ListMyOrders kullanicinin BUTUN siparislerini (sepet
// taslaklari dahil) yeniden eskiye verir. Burada:
//   - Sepet taslaklari gizlenir: DRAFT ve hic ilerlemeden suresi dolan
//     (gecmisi yalnizca DRAFT ve EXPIRED olan) siparis. Sunucu tarafi durum
//     filtresi bekleyen is #101.
//   - Sayfa kisa kalirsa en fazla MaxRounds tur okunur; her turda yalnizca
//     eksik kadar istenir, sayfa istenen boyu ASMAZ.
//   - Market adlari sayfa basina TEK BatchGetMarkets ile gelir (siparis
//     basina GetMarket N+1 olurdu). Katalog cevap vermezse ya da market
//     kaldirilmissa ad bos kalir; istemci "Market" yazar. Adlar suslemedir:
//     katalog arizasi kullanicinin siparislerini gizlemez.
//   - Ucreti alinmis siparisin iptali (gecmiste PAID, durum CANCELLED)
//     "refunded" isaretlenir: iade odeme servisindedir (T7.4); burada
//     yalnizca gecmisten cikarilir, odeme servisi okunmaz.
package orderhistory

import (
	"context"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// Sayfa kurallari (@getir/contracts ORDER_HISTORY_PAGE_SIZE_*; esitligi
// contract_test.go denetler).
const (
	// DefaultPageSize, istemci boy vermezse.
	DefaultPageSize = 20
	// MaxPageSize, katalogun BatchGetMarkets siniri (50 kimlik): sayfanin
	// marketleri tek cagriya sigar.
	MaxPageSize = 50
	// MaxRounds, kisa kalan sayfayi doldurmak icin order'a en fazla tur.
	MaxRounds = 3
)

// Siparis durumlari (@getir/core ORDER_STATUS).
const (
	statusDraft     = "DRAFT"
	statusExpired   = "EXPIRED"
	statusPaid      = "PAID"
	statusCancelled = "CANCELLED"
)

// Orders, siparislerin ham sayfasi (gercegi order.Service).
type Orders interface {
	Page(ctx context.Context, userID string, pageSize int32, pageToken string) (order.OrderPage, error)
}

// Markets, marketleri TEK cagrida okuyan katalog (gercegi catalog.Service).
type Markets interface {
	MarketsByIDs(ctx context.Context, marketIDs []string) ([]catalog.Market, error)
}

// Summary, gecmis listesinin satiri (@getir/contracts orderSummarySchema).
type Summary struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	MarketID string `json:"marketId"`
	// MarketName, katalogdaki ad; bulunamadiysa HIC yazilmaz.
	MarketName string     `json:"marketName,omitempty"`
	Total      rest.Money `json:"total"`
	// Refunded, ucreti alinmis siparisin iptali; degilse HIC yazilmaz.
	Refunded  bool   `json:"refunded,omitempty"`
	CreatedAt string `json:"createdAt"`
}

// Page, imlec tabanli sayfalama (@getir/contracts pageSchema). Suzme yuzunden
// toplam sayilmaz: TotalSize hep 0 ("sayilmadi").
type Page struct {
	NextPageToken string `json:"nextPageToken"`
	TotalSize     int32  `json:"totalSize"`
}

// List, GET /v1/orders cevabi (orderSummaryListSchema). Bos liste JSON'da [].
type List struct {
	Items []Summary `json:"items"`
	Page  Page      `json:"page"`
}

// Service, Gecmis Siparislerim'in is kurali.
type Service struct {
	orders  Orders
	markets Markets
}

// New, servisi kurar.
func New(orders Orders, markets Markets) *Service {
	return &Service{orders: orders, markets: markets}
}

// PageSize, istenen boyun uygulanan hali: 0 ve alti varsayilan, ust sinir
// MaxPageSize (pageQuerySchema gibi kirpilir, reddedilmez).
func PageSize(requested int32) int32 {
	switch {
	case requested <= 0:
		return DefaultPageSize
	case requested > MaxPageSize:
		return MaxPageSize
	default:
		return requested
	}
}

// List, kullanicinin gecmis siparisleri, yeniden eskiye.
func (s *Service) List(ctx context.Context, userID string, pageSize int32, pageToken string) (List, error) {
	size := PageSize(pageSize)
	visible := make([]order.Order, 0, size)
	token := pageToken
	for range MaxRounds {
		page, err := s.orders.Page(ctx, userID, size-int32(len(visible)), token)
		if err != nil {
			return List{}, err
		}
		for _, candidate := range page.Orders {
			if Visible(candidate) {
				visible = append(visible, candidate)
			}
		}
		token = page.NextPageToken
		if token == "" || int32(len(visible)) >= size {
			break
		}
	}
	names := s.marketNames(ctx, visible)
	items := make([]Summary, 0, len(visible))
	for _, shown := range visible {
		items = append(items, Summary{
			ID:         shown.ID,
			Status:     shown.Status,
			MarketID:   shown.MarketID,
			MarketName: names[shown.MarketID],
			Total:      shown.Total,
			Refunded:   Refunded(shown),
			CreatedAt:  shown.CreatedAt,
		})
	}
	return List{Items: items, Page: Page{NextPageToken: token}}, nil
}

// Visible, siparis gecmiste gorunur mu: sepet taslagi (DRAFT) ve hic
// ilerlemeden suresi dolan taslak gorunmez.
func Visible(candidate order.Order) bool {
	switch candidate.Status {
	case statusDraft:
		return false
	case statusExpired:
		for _, entry := range candidate.Timeline {
			if entry.Status != statusDraft && entry.Status != statusExpired {
				return true
			}
		}
		return false
	default:
		return true
	}
}

// Refunded, ucreti alinmis siparis mi iptal edildi (gecmiste PAID).
func Refunded(candidate order.Order) bool {
	if candidate.Status != statusCancelled {
		return false
	}
	for _, entry := range candidate.Timeline {
		if entry.Status == statusPaid {
			return true
		}
	}
	return false
}

// marketNames, sayfanin marketlerinin adlari (tekil kimliklerle TEK cagri).
// Katalog arizasinda bos harita: adlar suslemedir.
func (s *Service) marketNames(ctx context.Context, orders []order.Order) map[string]string {
	ids := make([]string, 0, len(orders))
	seen := map[string]bool{}
	for _, shown := range orders {
		if !seen[shown.MarketID] {
			seen[shown.MarketID] = true
			ids = append(ids, shown.MarketID)
		}
	}
	names := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return names
	}
	markets, err := s.markets.MarketsByIDs(ctx, ids)
	if err != nil {
		return names
	}
	for _, market := range markets {
		names[market.ID] = market.Name
	}
	return names
}
