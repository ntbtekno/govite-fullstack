// Package loginlog appends one plain-text line per login attempt to a daily
// file under logs/, and prunes files older than a retention window. It is a
// best-effort side channel next to the database audit: a write or prune failure
// is reported through OnError and never blocks or fails the login.
package loginlog

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// RetentionDays is how long a daily file is kept before the sweep removes it.
const RetentionDays = 30

// prefix names the daily files: auth-YYYY-MM-DD.log.
const prefix = "auth-"

// Record is the metadata written for one login attempt. It deliberately holds
// no password, captcha code/id, or token.
type Record struct {
	Time      time.Time
	Endpoint  string
	MitraKode string // empty for the Superadmin login
	Login     string // the username or email that was typed
	Status    int    // HTTP status the attempt produced
	ErrCode   string // error code when it failed, empty on success
	IP        string
}

// Logger writes daily login-attempt files in Dir and prunes old ones. The zero
// value is not usable; build one with New. A nil *Logger is a no-op, so callers
// can record unconditionally.
type Logger struct {
	dir       string
	retention int
	// now lets tests pin the clock; production leaves it time.Now.
	now func() time.Time
	// onError reports a write/prune failure (already non-fatal). Tests capture
	// it; production leaves it nil so failures only reach stderr.
	onError func(error)

	mu sync.Mutex
}

// New returns a Logger rooted at dir. onError, if non-nil, is called with any
// non-fatal failure. It does not create the directory; the first write does.
func New(dir string, onError func(error)) *Logger {
	return &Logger{dir: dir, retention: RetentionDays, now: time.Now, onError: onError}
}

// SetClock overrides the clock, for tests only.
func (l *Logger) SetClock(now func() time.Time) {
	if l == nil {
		return
	}
	l.now = now
}

func (l *Logger) fail(err error) {
	if l == nil || err == nil {
		return
	}
	if l.onError != nil {
		l.onError(err)
	}
}

// file returns the path of the file for the day d in local time.
func (l *Logger) file(d time.Time) string {
	return filepath.Join(l.dir, prefix+d.Format("2006-01-02")+".log")
}

// Endpoint label recorded for a Superadmin (/auth/login) attempt.
const EndpointLogin = "/auth/login"

// Endpoint label recorded for a mitra (/auth/login-mitra) attempt.
const EndpointLoginMitra = "/auth/login-mitra"

// Record appends one line for r. A failure is reported, never returned.
func (l *Logger) Record(r Record) {
	if l == nil {
		return
	}
	ts := r.Time
	if ts.IsZero() {
		ts = l.now()
	}
	ts = ts.Local()
	// Fields are joined with tabs: no field can forge another, and a value can
	// never contain a newline (login/mitra code are single-line identifiers).
	code := r.ErrCode
	if code == "" {
		code = "-"
	}
	mitra := r.MitraKode
	if mitra == "" {
		mitra = "-"
	}
	line := strings.Join([]string{
		ts.Format("2006-01-02T15:04:05.000-07:00"),
		clean(r.Endpoint),
		clean(mitra),
		clean(r.Login),
		fmt.Sprintf("%d", r.Status),
		clean(code),
		clean(r.IP),
	}, "\t") + "\n"

	l.mu.Lock()
	defer l.mu.Unlock()
	path := l.file(ts)
	if err := os.MkdirAll(l.dir, 0o755); err != nil {
		l.fail(err)
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		l.fail(err)
		return
	}
	defer f.Close()
	if _, err := f.WriteString(line); err != nil {
		l.fail(err)
	}
}

// clean strips tabs and newlines so a value cannot break the one-line format.
func clean(s string) string {
	return strings.NewReplacer("\t", " ", "\n", " ", "\r", " ").Replace(s)
}

// Sweep removes auth-*.log files whose date is older than the retention window,
// keeping files dated within the last RetentionDays days (including today). A
// failure is reported, never returned.
func (l *Logger) Sweep() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now().Local()
	// Compare by calendar day: files dated exactly retention days ago are kept,
	// older ones are removed.
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	cutoff := today.AddDate(0, 0, -l.retention)
	entries, err := os.ReadDir(l.dir)
	if err != nil {
		// A missing directory is not a failure: nothing to prune yet.
		if !os.IsNotExist(err) {
			l.fail(err)
		}
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), prefix) || !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		day, ok := parseDay(e.Name())
		if !ok {
			continue
		}
		if day.Before(cutoff) { // midnight vs midnight: strictly older than cutoff
			if err := os.Remove(filepath.Join(l.dir, e.Name())); err != nil {
				l.fail(err)
			}
		}
	}
}

// parseDay extracts the date from auth-YYYY-MM-DD.log.
func parseDay(name string) (time.Time, bool) {
	day, err := time.ParseInLocation("2006-01-02", strings.TrimSuffix(strings.TrimPrefix(name, prefix), ".log"), time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return day, true
}

// RunDaily sweeps now and then once per day at 03:17 local time until ctx ends.
// It mirrors the maintenance cleanup cadence.
func (l *Logger) RunDaily(ctx interface{ Done() <-chan struct{} }) {
	l.Sweep()
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day(), 3, 17, 0, 0, now.Location())
		if !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			l.Sweep()
		}
	}
}
