package http

import (
	"github.com/gofiber/fiber/v2"

	"govite/internal/kernel"
	"govite/internal/mitra/application"
	"govite/internal/mitra/domain"
	"govite/internal/platform/httpx"
	"govite/internal/rbac"
)

type Handler struct {
	Svc   *application.Service
	Audit kernel.Auditor
}

type listQuery struct {
	httpx.Pagination
}

func (q *listQuery) filter() domain.Filter {
	q.Normalize()
	return domain.Filter{Search: q.SearchPtr()}
}

func (h Handler) audit(c *fiber.Ctx, action, id string, after any) {
	h.Audit.Record(c.UserContext(), action, "mitra", id, nil, after)
}

func (h Handler) Routes(g rbac.Guarded) {
	g.Get("/mitra", "mitra.view", func(c *fiber.Ctx) error {
		var q listQuery
		if err := httpx.Query(c, &q); err != nil {
			return err
		}
		rows, total, err := h.Svc.List(c.UserContext(), q.filter(), int32(q.Limit), q.Offset())
		if err != nil {
			return err
		}
		return httpx.Page(c, rows, httpx.NewPageMeta(total, q.Page, q.Limit))
	})

	g.Get("/mitra/:id", "mitra.view", func(c *fiber.Ctx) error {
		id, err := httpx.ID(c, "id")
		if err != nil {
			return err
		}
		v, err := h.Svc.Get(c.UserContext(), id)
		if err != nil {
			return err
		}
		return httpx.OK(c, v)
	})

	g.Post("/mitra", "mitra.manage", func(c *fiber.Ctx) error {
		var b application.CreateInput
		if err := httpx.Body(c, &b); err != nil {
			return err
		}
		v, err := h.Svc.Create(c.UserContext(), b)
		if err != nil {
			return err
		}
		h.audit(c, "mitra.create", v.ID, v)
		return httpx.Created(c, v)
	})

	g.Put("/mitra/:id", "mitra.manage", func(c *fiber.Ctx) error {
		id, err := httpx.ID(c, "id")
		if err != nil {
			return err
		}
		var b application.UpdateInput
		if err := httpx.Body(c, &b); err != nil {
			return err
		}
		v, err := h.Svc.Update(c.UserContext(), id, b)
		if err != nil {
			return err
		}
		h.audit(c, "mitra.update", id, v)
		return httpx.OK(c, v)
	})

	g.Patch("/mitra/:id/active", "mitra.manage", func(c *fiber.Ctx) error {
		id, err := httpx.ID(c, "id")
		if err != nil {
			return err
		}
		var b application.ActiveInput
		if err := httpx.Body(c, &b); err != nil {
			return err
		}
		v, err := h.Svc.SetActive(c.UserContext(), id, b)
		if err != nil {
			return err
		}
		h.audit(c, "mitra.set_active", id, v)
		return httpx.OK(c, v)
	})
}
