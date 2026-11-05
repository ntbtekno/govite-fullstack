package loginlog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fixed pins the logger clock so filenames are deterministic.
func fixed(l *Logger, at time.Time) *Logger {
	l.SetClock(func() time.Time { return at })
	return l
}

func TestRecordWritesOneLinePerAttemptWithFields(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 3, 4, 9, 15, 30, 0, time.Local)
	l := fixed(New(dir, nil), now)

	l.Record(Record{
		Endpoint:  EndpointLoginMitra,
		MitraKode: "MTR-E2E",
		Login:     "unram@mitrantbs.co.id",
		Status:    201,
		IP:        "203.0.113.7",
	})

	raw, err := os.ReadFile(filepath.Join(dir, "auth-2026-03-04.log"))
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	if len(lines) != 1 {
		t.Fatalf("want exactly 1 line, got %d: %q", len(lines), string(raw))
	}
	fields := strings.Split(lines[0], "\t")
	if len(fields) != 7 {
		t.Fatalf("want 7 tab-separated fields, got %d: %q", len(fields), lines[0])
	}
	if !strings.HasPrefix(fields[0], "2026-03-04T09:15:30") {
		t.Errorf("timestamp: %q", fields[0])
	}
	want := []string{
		EndpointLoginMitra, "MTR-E2E", "unram@mitrantbs.co.id", "201", "-", "203.0.113.7",
	}
	for i, w := range want {
		if fields[i+1] != w {
			t.Errorf("field %d: want %q got %q", i+1, w, fields[i+1])
		}
	}
}

func TestRecordFailedAttemptCarriesStatusAndCode(t *testing.T) {
	dir := t.TempDir()
	l := fixed(New(dir, nil), time.Date(2026, 3, 4, 0, 0, 0, 0, time.Local))

	l.Record(Record{Endpoint: EndpointLogin, Login: "root@test.local", Status: 401, ErrCode: "INVALID_CREDENTIALS", IP: "198.51.100.9"})

	raw, _ := os.ReadFile(filepath.Join(dir, "auth-2026-03-04.log"))
	line := strings.TrimSpace(string(raw))
	if !strings.Contains(line, "\t401\tINVALID_CREDENTIALS\t") {
		t.Fatalf("status/code missing: %q", line)
	}
	// The Superadmin login has no mitra code: it must be the '-' placeholder.
	if !strings.Contains(line, EndpointLogin+"\t-\t") {
		t.Fatalf("missing mitra placeholder: %q", line)
	}
}

func TestSweepKeepsRecentAndRemoves31Days(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 3, 31, 12, 0, 0, 0, time.Local)
	l := fixed(New(dir, nil), now)

	// Files dated: 31 days ago (drop), 30 days ago (keep), today (keep).
	old := now.AddDate(0, 0, -31).Format("2006-01-02")
	edge := now.AddDate(0, 0, -30).Format("2006-01-02")
	today := now.Format("2006-01-02")
	for _, d := range []string{old, edge, today} {
		if err := os.WriteFile(filepath.Join(dir, "auth-"+d+".log"), []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A non-matching file must never be touched.
	other := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(other, []byte("keep\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	l.Sweep()

	if _, err := os.Stat(filepath.Join(dir, "auth-"+old+".log")); !os.IsNotExist(err) {
		t.Errorf("31-day-old file should be removed, err=%v", err)
	}
	for _, d := range []string{edge, today} {
		if _, err := os.Stat(filepath.Join(dir, "auth-"+d+".log")); err != nil {
			t.Errorf("file %s should be kept: %v", d, err)
		}
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("unrelated file should be kept: %v", err)
	}
}

func TestRecordReportsWriteFailureWithoutPanicking(t *testing.T) {
	// A path whose parent is a regular file cannot be created as a directory.
	dir := t.TempDir()
	blocker := filepath.Join(dir, "logs")
	if err := os.WriteFile(blocker, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	var got error
	l := fixed(New(blocker, func(err error) { got = err }), time.Now())

	l.Record(Record{Endpoint: EndpointLogin, Login: "u", Status: 500})

	if got == nil {
		t.Fatal("expected a reported write failure")
	}
}
