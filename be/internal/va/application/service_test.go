package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"govite/internal/kernel"
	"govite/internal/va/domain"
)

type fakeRepo struct {
	kode     string
	inserted domain.Request
	saved    []string
}

func (r *fakeRepo) MitraKode(context.Context, string) (string, error) { return r.kode, nil }
func (r *fakeRepo) Insert(_ context.Context, v domain.Request) error  { r.inserted = v; return nil }
func (r *fakeRepo) SaveResult(_ context.Context, _, va, code, _, status, _ string, _ time.Time) error {
	r.saved = []string{va, code, status}
	return nil
}

type fakeGateway struct {
	createReq                 domain.CreateRequest
	createResult              domain.CreateResult
	createErr                 error
	inquiryReq                domain.InquiryRequest
	inquiryResult             domain.CreateResult
	inquiryErr                error
	createCalls, inquiryCalls int
}

func (g *fakeGateway) Enabled() bool { return true }
func (g *fakeGateway) CreateVA(_ context.Context, req domain.CreateRequest) (domain.CreateResult, error) {
	g.createCalls++
	g.createReq = req
	return g.createResult, g.createErr
}
func (g *fakeGateway) InquiryVA(_ context.Context, req domain.InquiryRequest) (domain.CreateResult, error) {
	g.inquiryCalls++
	g.inquiryReq = req
	return g.inquiryResult, g.inquiryErr
}

func validRequest() domain.CreateRequest {
	return domain.CreateRequest{CustomerNo: "00000000000123", TrxID: "INV-1", VirtualAccountName: "Budi", Amount: "1000.00", TrxType: "F", ExpiredDate: time.Now().Add(time.Hour)}
}
func mitraContext() context.Context {
	return kernel.WithPrincipal(context.Background(), kernel.Principal{ID: "u", MitraID: "mitra-a"})
}

func TestCreateUsesPrincipalMitraCredentialsAndStoresSuccess(t *testing.T) {
	repo := &fakeRepo{kode: "010"}
	gw := &fakeGateway{createResult: domain.CreateResult{ResponseCode: "2002700", VirtualAccountNo: "0104100000000000123", Status: "ACTIVE"}}
	s := &Service{Repo: repo, Gateway: gw, NewID: func() string { return "1234567890abcdef-extra" }}
	got, err := s.Create(mitraContext(), validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if gw.createReq.MitraKode != "010" || gw.createReq.PartnerServiceID != "010" {
		t.Fatalf("tenant credentials not derived from principal: %+v", gw.createReq)
	}
	if repo.inserted.MitraID != "mitra-a" || repo.inserted.ExternalID != "1234567890abcdef" {
		t.Fatalf("wrong persisted tenant/request: %+v", repo.inserted)
	}
	if got.Status != "ACTIVE" || len(repo.saved) != 3 || repo.saved[2] != "ACTIVE" {
		t.Fatalf("success not stored: %+v %#v", got, repo.saved)
	}
}

func TestConflictIsFinalWithoutInquiry(t *testing.T) {
	for _, gatewayErr := range []error{domain.ErrAlreadyPaid, domain.ErrAlreadyActive} {
		t.Run(domain.Code(gatewayErr), func(t *testing.T) {
			repo := &fakeRepo{kode: "010"}
			gw := &fakeGateway{createErr: gatewayErr}
			_, err := (&Service{Repo: repo, Gateway: gw}).Create(mitraContext(), validRequest())
			if domain.Code(err) != domain.Code(gatewayErr) || gw.createCalls != 1 || gw.inquiryCalls != 0 {
				t.Fatalf("conflict retried/inquired: %v create=%d inquiry=%d", err, gw.createCalls, gw.inquiryCalls)
			}
		})
	}
}

func TestTransientCreateRecoversThroughInquiry(t *testing.T) {
	repo := &fakeRepo{kode: "010"}
	gw := &fakeGateway{createErr: context.DeadlineExceeded, inquiryResult: domain.CreateResult{ResponseCode: "2003000", VirtualAccountNo: "0104100000000000123", Status: "ACTIVE"}}
	got, err := (&Service{Repo: repo, Gateway: gw}).Create(mitraContext(), validRequest())
	if err != nil || got.Status != "ACTIVE" || gw.createCalls != 1 || gw.inquiryCalls != 1 {
		t.Fatalf("recovery failed: got=%+v err=%v calls=%d/%d", got, err, gw.createCalls, gw.inquiryCalls)
	}
	if gw.inquiryReq.TrxID != "INV-1" || gw.inquiryReq.MitraKode != "010" {
		t.Fatalf("wrong inquiry: %+v", gw.inquiryReq)
	}
}

func TestTransientCreateInquiryMissMarksFailedWithoutRetry(t *testing.T) {
	repo := &fakeRepo{kode: "010"}
	gw := &fakeGateway{createErr: domain.ErrServer, inquiryErr: errors.New("not found")}
	_, err := (&Service{Repo: repo, Gateway: gw}).Create(mitraContext(), validRequest())
	if err == nil || gw.createCalls != 1 || gw.inquiryCalls != 1 || len(repo.saved) != 3 || repo.saved[2] != "FAILED" {
		t.Fatalf("unexpected miss handling: err=%v calls=%d/%d saved=%#v", err, gw.createCalls, gw.inquiryCalls, repo.saved)
	}
}
