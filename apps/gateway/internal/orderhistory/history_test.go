package orderhistory

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// fakeOrders, order'in ListMyOrders'i: siparisleri imlecle (siradaki dizin)
// sayfa sayfa verir; her istegi kaydeder.
type fakeOrders struct {
	all      []order.Order
	requests []int32
	err      error
}

func (f *fakeOrders) Page(_ context.Context, _ string, pageSize int32, pageToken string) (order.OrderPage, error) {
	f.requests = append(f.requests, pageSize)
	if f.err != nil {
		return order.OrderPage{}, f.err
	}
	start := 0
	if pageToken != "" {
		if _, err := fmt.Sscanf(pageToken, "%d", &start); err != nil {
			return order.OrderPage{}, err
		}
	}
	end := min(start+int(pageSize), len(f.all))
	page := order.OrderPage{Orders: f.all[start:end]}
	if end < len(f.all) {
		page.NextPageToken = fmt.Sprint(end)
	}
	return page, nil
}

type fakeMarkets struct {
	names map[string]string
	calls [][]string
	err   error
}

func (f *fakeMarkets) MarketsByIDs(_ context.Context, ids []string) ([]catalog.Market, error) {
	f.calls = append(f.calls, ids)
	if f.err != nil {
		return nil, f.err
	}
	markets := []catalog.Market{}
	for _, id := range ids {
		if name, found := f.names[id]; found {
			markets = append(markets, catalog.Market{ID: id, Name: name})
		}
	}
	return markets, nil
}

func placed(id, status, marketID string, history ...string) order.Order {
	timeline := make([]order.TimelineEntry, 0, len(history))
	for _, step := range history {
		timeline = append(timeline, order.TimelineEntry{Status: step})
	}
	return order.Order{
		ID: id, Status: status, MarketID: marketID, Timeline: timeline,
		Total: rest.Money{AmountMinor: 50_000, Currency: "TRY"}, CreatedAt: "2026-10-05T09:00:00Z",
	}
}

func TestVisibleHidesCartDraftsOnly(t *testing.T) {
	cases := map[string]struct {
		order order.Order
		want  bool
	}{
		"taslak":                       {placed("o", "DRAFT", "m", "DRAFT"), false},
		"ilerlemeden suresi dolan":     {placed("o", "EXPIRED", "m", "DRAFT", "EXPIRED"), false},
		"odeme beklerken suresi dolan": {placed("o", "EXPIRED", "m", "DRAFT", "RESERVED", "AWAITING_PAYMENT", "EXPIRED"), true},
		"teslim edilen":                {placed("o", "DELIVERED", "m", "DRAFT", "PAID", "DELIVERED"), true},
		"yolda":                        {placed("o", "ON_THE_WAY", "m", "DRAFT", "PAID", "ON_THE_WAY"), true},
		"iptal":                        {placed("o", "CANCELLED", "m", "DRAFT", "CANCELLED"), true},
	}
	for name, tc := range cases {
		if got := Visible(tc.order); got != tc.want {
			t.Errorf("%s: gorunur %v bekleniyordu", name, tc.want)
		}
	}
}

func TestRefundedOnlyWhenPaidThenCancelled(t *testing.T) {
	if !Refunded(placed("o", "CANCELLED", "m", "DRAFT", "PAID", "CANCELLED")) {
		t.Error("odenmis siparisin iptali iade sayilmali")
	}
	if Refunded(placed("o", "CANCELLED", "m", "DRAFT", "RESERVED", "CANCELLED")) {
		t.Error("odenmemis siparisin iptali iade degil")
	}
	if Refunded(placed("o", "DELIVERED", "m", "DRAFT", "PAID", "DELIVERED")) {
		t.Error("teslim edilen iade degil")
	}
}

func TestPageSizeIsClamped(t *testing.T) {
	for requested, want := range map[int32]int32{0: DefaultPageSize, -3: DefaultPageSize, 7: 7, 50: 50, 51: MaxPageSize, 100: MaxPageSize} {
		if got := PageSize(requested); got != want {
			t.Errorf("PageSize(%d) = %d, beklenen %d", requested, got, want)
		}
	}
}

func TestListFillsShortPagesWithoutExceedingTheSize(t *testing.T) {
	// 3 kalemlik sayfa: ilk turda 2 taslak + 1 siparis, ikinci turda eksik 2 istenir.
	orders := &fakeOrders{all: []order.Order{
		placed("o1", "DRAFT", "mkt_a", "DRAFT"),
		placed("o2", "DELIVERED", "mkt_a", "DRAFT", "PAID", "DELIVERED"),
		placed("o3", "EXPIRED", "mkt_b", "DRAFT", "EXPIRED"),
		placed("o4", "PREPARING", "mkt_b", "DRAFT", "PAID", "PREPARING"),
		placed("o5", "CANCELLED", "mkt_a", "DRAFT", "PAID", "CANCELLED"),
		placed("o6", "DELIVERED", "mkt_c", "DRAFT", "PAID", "DELIVERED"),
	}}
	markets := &fakeMarkets{names: map[string]string{"mkt_a": "A101 Caferağa", "mkt_b": "Migros Jet"}}
	service := New(orders, markets)

	list, err := service.List(context.Background(), "usr_1", 3, "")

	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	ids := []string{}
	for _, item := range list.Items {
		ids = append(ids, item.ID)
	}
	if fmt.Sprint(ids) != "[o2 o4 o5]" || fmt.Sprint(orders.requests) != "[3 2]" {
		t.Errorf("taslaklar atlanip eksik kadar istenmeli: %v istekler %v", ids, orders.requests)
	}
	if list.Page.NextPageToken != "5" || list.Page.TotalSize != 0 {
		t.Errorf("imlec okunan son siparisten devam etmeli, toplam sayilmaz: %+v", list.Page)
	}
	if len(markets.calls) != 1 || fmt.Sprint(markets.calls[0]) != "[mkt_a mkt_b]" {
		t.Errorf("sayfanin marketleri tekil kimliklerle TEK cagrida: %v", markets.calls)
	}
	if list.Items[0].MarketName != "A101 Caferağa" || !list.Items[2].Refunded || list.Items[1].Refunded {
		t.Errorf("ad ve iade isareti: %+v", list.Items)
	}
}

func TestListStopsAfterMaxRounds(t *testing.T) {
	all := []order.Order{}
	for i := range 10 {
		all = append(all, placed(fmt.Sprint("t", i), "DRAFT", "mkt_a", "DRAFT"))
	}
	orders := &fakeOrders{all: all}
	service := New(orders, &fakeMarkets{})

	list, err := service.List(context.Background(), "usr_1", 2, "")

	if err != nil || len(list.Items) != 0 || len(orders.requests) != MaxRounds || list.Page.NextPageToken == "" {
		t.Errorf("en fazla %d tur, bos sayfa ve devam imleci: %+v istekler %v (%v)", MaxRounds, list, orders.requests, err)
	}
}

func TestMissingOrFailingCatalogLeavesNamesEmpty(t *testing.T) {
	orders := &fakeOrders{all: []order.Order{placed("o1", "DELIVERED", "mkt_kalkti", "DRAFT", "PAID", "DELIVERED")}}

	list, err := New(orders, &fakeMarkets{names: map[string]string{}}).List(context.Background(), "usr_1", 0, "")
	if err != nil || list.Items[0].MarketName != "" {
		t.Errorf("katalogda olmayan market adsiz: %+v (%v)", list, err)
	}
	list, err = New(orders, &fakeMarkets{err: errors.New("katalog kapali")}).List(context.Background(), "usr_1", 0, "")
	if err != nil || len(list.Items) != 1 || list.Items[0].MarketName != "" {
		t.Errorf("katalog arizasi siparisleri gizlememeli: %+v (%v)", list, err)
	}
}

func TestEmptyHistoryIsAnEmptyList(t *testing.T) {
	markets := &fakeMarkets{}
	list, err := New(&fakeOrders{}, markets).List(context.Background(), "usr_1", 0, "")

	if err != nil || list.Items == nil || len(list.Items) != 0 || len(markets.calls) != 0 {
		t.Errorf("bos gecmis [] ve katalog cagrisi yok: %+v %v (%v)", list, markets.calls, err)
	}
}

func TestOrderErrorIsReturned(t *testing.T) {
	_, err := New(&fakeOrders{err: errors.New("order kapali")}, &fakeMarkets{}).List(context.Background(), "usr_1", 0, "")

	if err == nil {
		t.Error("order hatasi donmeli")
	}
}
