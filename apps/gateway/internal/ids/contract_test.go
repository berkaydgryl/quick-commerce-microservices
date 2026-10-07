package ids

import (
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Onekler iki yerde yazilidir: @getir/core id.ts (Node servisleri ve
// sozlesme semalari) ve bu paket. Biri degisip digeri unutulursa gateway'in
// urettigi ya da denetledigi kimligi Node tarafi reddederdi (QA S5).

func TestPrefixesMatchCore(t *testing.T) {
	core := testkit.StringRecord(t, testkit.ReadContract(t, testkit.CoreIDPath), "ID_PREFIX")
	for key, goValue := range map[string]string{
		"REQUEST": Request,
		"USER":    User,
		"SESSION": Session,
		"DEVICE":  Device,
		"ADDRESS": Address,
		"CARD":    Card,
		"ORDER":   Order,
		"COURIER": Courier,
	} {
		coreValue, found := core[key]
		if !found {
			t.Errorf("%s core ID_PREFIX'te yok (gateway %q)", key, goValue)
			continue
		}
		if coreValue != goValue {
			t.Errorf("%s: core %q, gateway %q", key, coreValue, goValue)
		}
	}
}
