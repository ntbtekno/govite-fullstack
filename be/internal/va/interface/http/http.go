package http

import (
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"govite/internal/platform/httpx"
	"govite/internal/rbac"
	"govite/internal/va/application"
	"govite/internal/va/domain"
)

var digits = regexp.MustCompile(`^[0-9]{1,14}$`)
var amount = regexp.MustCompile(`^(0|[1-9][0-9]{0,17})\.[0-9]{2}$`)

type Handler struct{ Svc *application.Service }

type createReq struct {
	CustomerNo         string `json:"customerNo" validate:"required,max=14"`
	TrxID              string `json:"trxId" validate:"required,max=19"`
	VirtualAccountName string `json:"virtualAccountName" validate:"required,max=30"`
	Amount             string `json:"amount" validate:"required"`
	Type               string `json:"trxType" validate:"required,oneof=F P"`
	ExpiredAt          string `json:"expiredDate" validate:"required"`
	Description        string `json:"description" validate:"max=60"`
	Phone              string `json:"phone"`
}

func (b createReq) input(now time.Time) (domain.CreateRequest, error) {
	b.CustomerNo, b.TrxID, b.VirtualAccountName = strings.TrimSpace(b.CustomerNo), strings.TrimSpace(b.TrxID), strings.TrimSpace(b.VirtualAccountName)
	if b.TrxID == "" || b.VirtualAccountName == "" {
		return domain.CreateRequest{}, httpx.Validation("trxId and virtualAccountName are required")
	}
	if !digits.MatchString(b.CustomerNo) {
		return domain.CreateRequest{}, httpx.Validation("customerNo: must contain 1-14 digits")
	}
	if b.TrxID == "" || len(b.TrxID) > 19 {
		return domain.CreateRequest{}, httpx.Validation("trxId: must contain at most 19 characters")
	}
	if b.VirtualAccountName == "" || len(b.VirtualAccountName) > 30 {
		return domain.CreateRequest{}, httpx.Validation("virtualAccountName: must contain at most 30 characters")
	}
	if b.Type != "F" && b.Type != "P" {
		return domain.CreateRequest{}, httpx.Validation("trxType: must be F or P")
	}
	if len(strings.TrimSpace(b.Description)) > 60 {
		return domain.CreateRequest{}, httpx.Validation("description: must contain at most 60 characters")
	}
	if !amount.MatchString(b.Amount) {
		return domain.CreateRequest{}, httpx.Validation("amount: must be a decimal with exactly two fraction digits")
	}
	exp, err := time.Parse(time.RFC3339, b.ExpiredAt)
	if err != nil || !exp.After(now) {
		return domain.CreateRequest{}, httpx.Validation("expiredDate: must be a future RFC3339 timestamp")
	}
	return domain.CreateRequest{
		CustomerNo: strings.Repeat("0", 14-len(b.CustomerNo)) + b.CustomerNo,
		TrxID:      b.TrxID, VirtualAccountName: b.VirtualAccountName, Amount: b.Amount,
		Currency: "IDR", TrxType: b.Type, ExpiredDate: exp,
		Description: strings.TrimSpace(b.Description), Phone: strings.TrimSpace(b.Phone),
	}, nil
}

func (h Handler) Routes(g rbac.Guarded) {
	g.Post("/va", "va.create", func(c *fiber.Ctx) error {
		var body createReq
		if err := httpx.Body(c, &body); err != nil {
			return err
		}
		in, err := body.input(time.Now())
		if err != nil {
			return err
		}
		result, err := h.Svc.Create(c.UserContext(), in)
		if err != nil {
			return err
		}
		return httpx.Created(c, result)
	})
}
