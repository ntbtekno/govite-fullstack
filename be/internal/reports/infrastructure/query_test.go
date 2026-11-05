package infrastructure

import (
	"strings"
	"testing"
	"time"

	"govite/internal/reports/domain"
)

func TestBillingListUsesPrincipalMitra(t *testing.T) {
	sql, args := BuildBillingList(domain.Filter{MitraKode: "010", Limit: 10})

	if len(args) == 0 || args[0] != "010" {
		t.Fatalf("first arg must be the principal mitra kode, got %#v", args)
	}
	if strings.Contains(sql, "010") {
		t.Fatalf("mitra kode must be bound, not interpolated: %s", sql)
	}
	if !strings.Contains(sql, "LIMIT ? OFFSET ?") {
		t.Fatalf("expected bound limit/offset: %s", sql)
	}
}

func TestBillingSearchEscapesWildcards(t *testing.T) {
	_, args := BuildBillingList(domain.Filter{MitraKode: "010", Search: "50%_x", Limit: 10, Offset: 0})

	// args[1..3] are the three LIKE patterns.
	for i := 1; i <= 3; i++ {
		if args[i] != `%50\%\_x%` {
			t.Fatalf("arg %d: want escaped pattern, got %#v", i, args[i])
		}
	}
}

func TestBillingStatsMatchListFilters(t *testing.T) {
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
	f := domain.Filter{MitraKode: "010", Search: "budi", From: &from, To: &to, Limit: 10}

	_, listArgs := BuildBillingList(f)
	statsSQL, statsArgs := BuildBillingStats(f)

	if !strings.Contains(statsSQL, "COUNT(*)") || !strings.Contains(statsSQL, "SUM(tagihan)") {
		t.Fatalf("stats query must aggregate: %s", statsSQL)
	}
	// Stats drops only limit/offset from the list args.
	if len(statsArgs) != len(listArgs)-2 {
		t.Fatalf("stats args %d != list args %d - 2", len(statsArgs), len(listArgs))
	}
	for i := range statsArgs {
		if statsArgs[i] != listArgs[i] {
			t.Fatalf("arg %d differs: %#v vs %#v", i, statsArgs[i], listArgs[i])
		}
	}
}

func TestPaymentPrefixPattern(t *testing.T) {
	sql, args := BuildPaymentList(domain.Filter{MitraKode: "010", Limit: 10})

	if len(args) == 0 || args[0] != "01041%" {
		t.Fatalf("first arg must be the mitra VA prefix, got %#v", args)
	}
	if strings.Contains(sql, "01041") {
		t.Fatalf("pattern must be bound, not interpolated: %s", sql)
	}
	if !strings.Contains(sql, "reffacc LIKE ?") {
		t.Fatalf("expected reffacc LIKE placeholder: %s", sql)
	}
}

func TestPaymentEscapesKodeWildcards(t *testing.T) {
	_, args := BuildPaymentList(domain.Filter{MitraKode: "01%_", Limit: 10})

	if args[0] != `01\%\_41%` {
		t.Fatalf("want escaped prefix, got %#v", args[0])
	}
}

func TestPaymentSearchEscapesWildcards(t *testing.T) {
	_, args := BuildPaymentList(domain.Filter{MitraKode: "010", Search: "a%b_c", Limit: 10})

	// args[0] prefix, then the three search patterns.
	for i := 1; i <= 3; i++ {
		if args[i] != `%a\%b\_c%` {
			t.Fatalf("arg %d: want escaped pattern, got %#v", i, args[i])
		}
	}
}

func TestPaymentStatsMatchListFilters(t *testing.T) {
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
	f := domain.Filter{MitraKode: "010", Search: "ref", From: &from, To: &to, Limit: 10}
	_, listArgs := BuildPaymentList(f)
	statsSQL, statsArgs := BuildPaymentStats(f)

	if !strings.Contains(statsSQL, "SUM(txamt)") {
		t.Fatalf("stats query must sum txamt: %s", statsSQL)
	}
	if len(statsArgs) != len(listArgs)-2 {
		t.Fatalf("stats args %d != list args %d - 2", len(statsArgs), len(listArgs))
	}
	for i := range statsArgs {
		if statsArgs[i] != listArgs[i] {
			t.Fatalf("arg %d differs: %#v vs %#v", i, statsArgs[i], listArgs[i])
		}
	}
}
