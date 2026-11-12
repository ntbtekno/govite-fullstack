package infrastructure

import (
	"strings"

	"govite/internal/reports/domain"
)

// Pure SQL builders: they take a validated filter and return SQL plus bound
// arguments. No user input is ever concatenated into the SQL text.

const (
	billingColumns = `va, id_mitra, id_produk, name, billing_type, email, phone, datetime_expired, description, tagihan, datetime_created, status`
	paymentColumns = `id, txdate, reffacc, txdtstlmn, txid, txmsg, txamt`

	billingFrom = ` FROM billing_tagihan`
	paymentFrom = ` FROM t_transaksi`
)

// escapeLike escapes the LIKE metacharacters so user text matches literally.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func containsPattern(s string) string { return "%" + escapeLike(s) + "%" }

func billingWhere(f domain.Filter) (string, []any) {
	var b strings.Builder
	args := []any{f.MitraKode}
	b.WriteString(` WHERE id_mitra = ?`)
	if f.Search != "" {
		p := containsPattern(f.Search)
		b.WriteString(` AND (va LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`)
		args = append(args, p, p, p)
	}
	if f.From != nil {
		b.WriteString(` AND datetime_created >= ?`)
		args = append(args, *f.From)
	}
	if f.To != nil {
		b.WriteString(` AND datetime_created < ?`)
		args = append(args, *f.To)
	}
	return b.String(), args
}

// BuildBillingList is the page query, newest first.
func BuildBillingList(f domain.Filter) (string, []any) {
	where, args := billingWhere(f)
	args = append(args, f.Limit, f.Offset)
	return `SELECT ` + billingColumns + billingFrom + where + ` ORDER BY datetime_created DESC LIMIT ? OFFSET ?`, args
}

// BuildBillingStats is the count/sum query for the same filter.
func BuildBillingStats(f domain.Filter) (string, []any) {
	where, args := billingWhere(f)
	return `SELECT COUNT(*), COALESCE(SUM(tagihan), 0)` + billingFrom + where, args
}

// paymentMitraPattern is the VA prefix for a mitra: <kode>41%. The kode itself
// is escaped so a wildcard inside it stays literal; the whole value is bound.
func paymentMitraPattern(kode string) string {
	return escapeLike(kode) + "41%"
}

func paymentWhere(f domain.Filter) (string, []any) {
	var b strings.Builder
	args := []any{paymentMitraPattern(f.MitraKode)}
	b.WriteString(` WHERE reffacc LIKE ? ESCAPE '\\'`)
	if f.Search != "" {
		p := containsPattern(f.Search)
		b.WriteString(` AND (reffacc LIKE ? ESCAPE '\\' OR txid LIKE ? ESCAPE '\\' OR txmsg LIKE ? ESCAPE '\\')`)
		args = append(args, p, p, p)
	}
	if f.From != nil {
		b.WriteString(` AND txdtstlmn >= ?`)
		args = append(args, *f.From)
	}
	if f.To != nil {
		b.WriteString(` AND txdtstlmn < ?`)
		args = append(args, *f.To)
	}
	return b.String(), args
}

// BuildPaymentList is the page query, newest settlement first.
func BuildPaymentList(f domain.Filter) (string, []any) {
	where, args := paymentWhere(f)
	args = append(args, f.Limit, f.Offset)
	return `SELECT ` + paymentColumns + paymentFrom + where + ` ORDER BY txdtstlmn DESC LIMIT ? OFFSET ?`, args
}

// BuildPaymentStats is the count/sum query for the same filter.
func BuildPaymentStats(f domain.Filter) (string, []any) {
	where, args := paymentWhere(f)
	return `SELECT COUNT(*), COALESCE(SUM(txamt), 0)` + paymentFrom + where, args
}

// BuildMonthlyCounts groups the mitra's settled rows by settlement day and
// returns per-day counts. The day bucket is taken as-is from txdtstlmn (the
// History Payment page does the same: no timezone conversion is applied to the
// stored value). from is inclusive and to exclusive, both bound. The mitra
// scope reuses paymentWhere, so the LIKE prefix and escaping stay identical.
func BuildMonthlyCounts(f domain.Filter) (string, []any) {
	where, args := paymentWhere(f)
	return `SELECT DATE(txdtstlmn) AS d, COUNT(*)
		FROM t_transaksi` + where + `
		GROUP BY DATE(txdtstlmn)
		ORDER BY d`, args
}

// BuildMonthlyAmount sums txamt for the mitra's settled rows over the same
// [from, to) window and scope as BuildMonthlyCounts.
func BuildMonthlyAmount(f domain.Filter) (string, []any) {
	where, args := paymentWhere(f)
	return `SELECT COALESCE(SUM(txamt), 0)
		FROM t_transaksi` + where, args
}

// BuildMonthlyCoverage returns the MIN and MAX settlement dates over ALL of the
// mitra's stored rows (no date bound): the dashboard shows this so the user
// knows how far back the stored data goes, independent of the applied range.
func BuildMonthlyCoverage(f domain.Filter) (string, []any) {
	f.From = nil
	f.To = nil
	where, args := paymentWhere(f)
	return `SELECT MIN(txdtstlmn), MAX(txdtstlmn)
		FROM t_transaksi` + where, args
}
