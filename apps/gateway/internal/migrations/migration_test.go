package migrations

import (
	"context"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

func noop(context.Context, *mongo.Database) error { return nil }

func migration(version int, name string) Migration {
	return Migration{Version: version, Name: name, Up: noop, Down: noop}
}

func TestGatewayMigrationListIsValid(t *testing.T) {
	list := All()
	if err := checkList(list); err != nil {
		t.Fatalf("gateway'in goc listesi gecerli olmali: %v", err)
	}
	if list[0].Version != 1 || list[0].Name != "adres-kimlikleri" {
		t.Errorf("ilk goc 0001-adres-kimlikleri olmali (uygulanmis goc degistirilmez): %d %q", list[0].Version, list[0].Name)
	}
}

func TestCheckListRejectsBrokenLists(t *testing.T) {
	cases := map[string][]Migration{
		"sira bozuk":   {migration(2, "b"), migration(1, "a")},
		"surum sifir":  {migration(0, "a")},
		"ayni surum":   {migration(1, "a"), migration(1, "b")},
		"ayni ad":      {migration(1, "a"), migration(2, "a")},
		"bos ad":       {migration(1, " ")},
		"down eksik":   {{Version: 1, Name: "a", Up: noop}},
		"up eksik":     {{Version: 1, Name: "a", Down: noop}},
		"negatif sira": {migration(-1, "a")},
	}
	for name, list := range cases {
		if checkList(list) == nil {
			t.Errorf("%s: liste reddedilmeliydi", name)
		}
	}
}

func TestCompareFindsPendingAndConflicts(t *testing.T) {
	list := []Migration{migration(1, "a"), migration(2, "b"), migration(3, "c")}

	status := compare([]Record{{Version: 1, Name: "a"}}, list)
	if len(status.Conflicts) != 0 || len(status.Pending) != 2 || status.Pending[0].Version != 2 {
		t.Errorf("1 uygulanmis: 2 ve 3 bekler, tutarsizlik yok: %+v", status)
	}

	conflicts := map[string][]Record{
		"kayitta olup kodda olmayan": {{Version: 1, Name: "a"}, {Version: 9, Name: "z"}},
		"ayni surum farkli ad":       {{Version: 1, Name: "degisti"}},
		"bekleyen eski surum":        {{Version: 1, Name: "a"}, {Version: 3, Name: "c"}},
	}
	for name, records := range conflicts {
		if status := compare(records, list); len(status.Conflicts) == 0 {
			t.Errorf("%s: tutarsizlik bekleniyordu: %+v", name, status)
		}
	}

	// Kayitlar sirasiz gelse de surum sirasinda.
	status = compare([]Record{{Version: 2, Name: "b"}, {Version: 1, Name: "a"}}, list)
	if status.Applied[0].Version != 1 || len(status.Pending) != 1 || len(status.Conflicts) != 0 {
		t.Errorf("uygulanmislar surum sirasinda olmali: %+v", status)
	}
}

func TestNewAddressIDHasTheSharedFormat(t *testing.T) {
	// Goc donmus kopyadir (ids paketine baglanmaz) ama urettigi kimlik
	// gateway'in eklemede urettigiyle ayni bicimde olmali.
	seen := map[string]bool{}
	for range 100 {
		id, err := newAddressID()
		if err != nil || !ids.Valid(ids.Address, id) || seen[id] || !strings.HasPrefix(id, "adr_") {
			t.Fatalf("gecersiz ya da tekrar eden kimlik %q (%v)", id, err)
		}
		seen[id] = true
	}
}
