package http

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"govite/internal/platform/httpx"
	"govite/internal/rbac"
	"govite/internal/reports/application"
	"govite/internal/reports/domain"
)

const (
	defaultPageSize = 10
	maxPageSize     = 100
	dateLayout      = "2006-01-02"
	// maxRangeDays is the maximum difference (to - from) in days. A range of
	// 1 Jul .. 1 Aug is 31 days and is accepted; 1 Jul .. 2 Aug is 32 days and
	// is rejected.
	maxRangeDays = 31
)

type Handler struct {
	Svc *application.Service
}

type dashboardQuery struct {
	From string `query:"from"`
	To   string `query:"to"`
}

func (q dashboardQuery) parse() (*time.Time, *time.Time, error) {
	var from, to *time.Time
	if q.From != "" {
		t, err := time.Parse(dateLayout, q.From)
		if err != nil {
			return nil, nil, httpx.Validation("from: must be YYYY-MM-DD")
		}
		from = &t
	}
	if q.To != "" {
		t, err := time.Parse(dateLayout, q.To)
		if err != nil {
			return nil, nil, httpx.Validation("to: must be YYYY-MM-DD")
		}
		to = &t
	}
	if from != nil && to != nil && from.After(*to) {
		return nil, nil, httpx.Validation("from: cannot be after to")
	}
	if from != nil && to != nil {
		spanDays := int(to.Sub(*from).Hours() / 24)
		if spanDays > maxRangeDays {
			return nil, nil, httpx.Validation("range: cannot exceed 31 days")
		}
	}
	return from, to, nil
}

type listQuery struct {
	Q        string `query:"q" validate:"max=200"`
	From     string `query:"from"`
	To       string `query:"to"`
	Page     int    `query:"page" validate:"omitempty,min=1"`
	PageSize int    `query:"pageSize" validate:"omitempty,min=1"`
}

func (q listQuery) page() int {
	if q.Page < 1 {
		return 1
	}
	return q.Page
}

func (q listQuery) pageSize() int {
	if q.PageSize < 1 {
		return defaultPageSize
	}
	if q.PageSize > maxPageSize {
		return maxPageSize
	}
	return q.PageSize
}

// filter validates the date bounds and builds the repository filter. from is an
// inclusive lower bound; to is converted to the next day so the whole `to`
// calendar day is included.
func (q listQuery) filter() (domain.Filter, error) {
	var from, to *time.Time
	if q.From != "" {
		t, err := time.Parse(dateLayout, q.From)
		if err != nil {
			return domain.Filter{}, httpx.Validation("from: must be YYYY-MM-DD")
		}
		from = &t
	}
	if q.To != "" {
		t, err := time.Parse(dateLayout, q.To)
		if err != nil {
			return domain.Filter{}, httpx.Validation("to: must be YYYY-MM-DD")
		}
		end := t.AddDate(0, 0, 1)
		to = &end
	}
	size := q.pageSize()
	return domain.Filter{
		Search: strings.TrimSpace(q.Q),
		From:   from,
		To:     to,
		Limit:  size,
		Offset: (q.page() - 1) * size,
	}, nil
}

func (q listQuery) response(items any, total int64, summary domain.Summary) fiber.Map {
	return fiber.Map{
		"items":    items,
		"total":    total,
		"page":     q.page(),
		"pageSize": q.pageSize(),
		"summary":  summary,
	}
}

func (h Handler) Routes(g rbac.Guarded) {
	g.Get("/reports/billing", "billing.view", func(c *fiber.Ctx) error {
		var q listQuery
		if err := httpx.Query(c, &q); err != nil {
			return err
		}
		f, err := q.filter()
		if err != nil {
			return err
		}
		items, summary, err := h.Svc.Billing(c.UserContext(), f)
		if err != nil {
			return err
		}
		return httpx.OK(c, q.response(items, summary.Count, summary))
	})

	g.Get("/reports/payments", "payments.view", func(c *fiber.Ctx) error {
		var q listQuery
		if err := httpx.Query(c, &q); err != nil {
			return err
		}
		f, err := q.filter()
		if err != nil {
			return err
		}
		items, summary, err := h.Svc.Payments(c.UserContext(), f)
		if err != nil {
			return err
		}
		return httpx.OK(c, q.response(items, summary.Count, summary))
	})
}

// MeRoutes mounts the dashboard summary on the self-service group: any signed
// in caller may read it, no permission required. The monthly section is only
// filled for a mitra principal.
func (h Handler) MeRoutes(r fiber.Router) {
	r.Get("/dashboard/summary", func(c *fiber.Ctx) error {
		var q dashboardQuery
		if err := httpx.Query(c, &q); err != nil {
			return err
		}
		from, to, err := q.parse()
		if err != nil {
			return err
		}
		sum, err := h.Svc.DashboardSummary(c.UserContext(), from, to)
		if err != nil {
			return err
		}
		return httpx.OK(c, sum)
	})
}
