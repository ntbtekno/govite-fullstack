package application

import (
	"context"
	"errors"
	"testing"

	"govite/internal/kernel"
	"govite/internal/mitra/domain"
)

type fakeRepo struct {
	mitra                domain.Mitra
	createErr            error
	createCalls          int
	marked               bool
	partnerID, repairErr string
}

func (r *fakeRepo) Get(context.Context, string) (domain.Mitra, error) {
	if r.mitra.ID == "" {
		return domain.Mitra{}, domain.ErrNotFound
	}
	return r.mitra, nil
}
func (r *fakeRepo) List(context.Context, domain.Filter, int32, int32) ([]domain.Mitra, error) {
	return nil, nil
}
func (r *fakeRepo) Count(context.Context, domain.Filter) (int64, error) { return 0, nil }
func (r *fakeRepo) Create(_ context.Context, id, kode, nama string, active bool, psid, prefix, path, status string, partnerID, repairErr *string, connectionType string, delivered bool) error {
	r.createCalls++
	if r.createErr != nil && r.createCalls == 1 {
		return r.createErr
	}
	r.mitra = domain.Mitra{ID: id, KodeMitra: kode, Nama: nama, IsActive: active, PartnerServiceID: psid, VAPrefix: prefix, BundlePath: path, ProvisionStatus: status, ProvisionPartnerID: partnerID, ProvisionError: repairErr, ConnectionType: connectionType, CredentialsDelivered: delivered}
	return nil
}
func (r *fakeRepo) MarkNeedsRepair(_ context.Context, _ string, partnerID, repairErr string) error {
	r.marked = true
	r.partnerID, r.repairErr = partnerID, repairErr
	r.mitra.ProvisionStatus = domain.ProvisionStatusNeedsRepair
	return nil
}
func (r *fakeRepo) GetByKode(context.Context, string) (domain.Mitra, error) {
	if r.mitra.ID == "" {
		return domain.Mitra{}, domain.ErrNotFound
	}
	return r.mitra, nil
}
func (r *fakeRepo) Update(context.Context, string, domain.Changes) error { return nil }
func (r *fakeRepo) SetActive(context.Context, string, bool) error        { return nil }
func (r *fakeRepo) RevokeSessions(context.Context, string) error         { return nil }
func (r *fakeRepo) MarkReady(_ context.Context, _ string, delivered bool) error {
	r.mitra.ProvisionStatus = "READY"
	r.mitra.ProvisionError = nil
	r.mitra.CredentialsDelivered = delivered
	return nil
}

type fakeTx struct{}

func (fakeTx) Do(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }

type fakeProv struct {
	err        error
	result     domain.ProvisionResult
	rotate     domain.RotateResult
	replaced   []byte
	privateKey []byte
}

func (p fakeProv) Provision(context.Context, string, domain.ProvisionInput) (domain.ProvisionResult, error) {
	return p.result, p.err
}
func (p fakeProv) RotateSecret(context.Context, string, string) (domain.RotateResult, error) {
	return p.rotate, p.err
}
func (p *fakeProv) ReplaceSecret(_ string, secret []byte) error {
	p.replaced = append([]byte(nil), secret...)
	return p.err
}
func (p *fakeProv) ReadPrivateKey(string) ([]byte, error) { return p.privateKey, p.err }

func validCreateInput() CreateInput {
	return CreateInput{KodeMitra: "103", Nama: "Repair", PartnerServiceID: "     103", VAPrefix: "10341", BranchCode: "1030", CallbackUrl: strPtr("https://example.com/callback"), RateLimitTier: "standard", ConnectionType: domain.ConnectionPortalOnly}
}

func TestCreateRecordsNeedsRepairAfterBundleFailure(t *testing.T) {
	repo := &fakeRepo{}
	svc := &Service{Repo: repo, Tx: fakeTx{}, Prov: &fakeProv{err: &domain.ProvisionError{PartnerID: "P-REPAIR", Detail: "write private.pem: disk full", Cause: domain.ErrProvisionFailed}}}
	_, err := svc.Create(context.Background(), validCreateInput())
	var repair *domain.NeedsRepairError
	if !errors.As(err, &repair) || repair.Mitra.ProvisionStatus != domain.ProvisionStatusNeedsRepair || repair.Mitra.ProvisionPartnerID == nil || *repair.Mitra.ProvisionPartnerID != "P-REPAIR" {
		t.Fatalf("missing repair state: %T %v %+v", err, err, repo.mitra)
	}
}

func TestCreateRecordsNeedsRepairAfterDBFailureWithoutDeletingBundle(t *testing.T) {
	repo := &fakeRepo{createErr: errors.New("db unavailable")}
	svc := &Service{Repo: repo, Tx: fakeTx{}, SecretsDir: "/tmp/snap", Prov: &fakeProv{result: domain.ProvisionResult{PartnerID: "P-DB"}}}
	_, err := svc.Create(context.Background(), validCreateInput())
	var repair *domain.NeedsRepairError
	if !errors.As(err, &repair) || repair.Mitra.ProvisionStatus != domain.ProvisionStatusNeedsRepair || repair.Mitra.ProvisionPartnerID == nil || *repair.Mitra.ProvisionPartnerID != "P-DB" || repair.Mitra.ProvisionError == nil || *repair.Mitra.ProvisionError != "db unavailable" {
		t.Fatalf("missing DB repair state: %T %v %+v", err, err, repair)
	}
}

func TestValidateCreateAcceptsCompleteInput(t *testing.T) {
	in := CreateInput{
		KodeMitra:        "010",
		Nama:             "Mitra Sepuluh",
		PartnerServiceID: "     010",
		VAPrefix:         "01041",
		BranchCode:       "1010",
		CallbackUrl:      strPtr("https://mitra.example.com/callback"),
		RateLimitTier:    "standard",
		IPWhitelist:      []string{"127.0.0.1", "::1"},
		ConnectionType:   domain.ConnectionPortalOnly,
	}
	if err := validateCreate(in); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}

	in.IPWhitelist = nil
	if err := validateCreate(in); err != nil {
		t.Fatalf("valid input without IP whitelist rejected: %v", err)
	}
}

func TestValidateCreateRejectsBadInput(t *testing.T) {
	base := CreateInput{
		KodeMitra:        "010",
		Nama:             "Mitra Sepuluh",
		PartnerServiceID: "     010",
		VAPrefix:         "01041",
		BranchCode:       "1010",
		CallbackUrl:      strPtr("https://mitra.example.com/callback"),
		RateLimitTier:    "standard",
		IPWhitelist:      []string{"127.0.0.1"},
		ConnectionType:   domain.ConnectionPortalOnly,
	}
	reject := func(t *testing.T, in CreateInput, detail string) {
		t.Helper()
		err := validateCreate(in)
		if err == nil {
			t.Fatalf("expected rejection: %s", detail)
		}
		ke, ok := err.(*kernel.Error)
		if !ok || ke.Detail != detail {
			t.Fatalf("wrong error: %v", err)
		}
	}
	t.Helper()

	reject(t, func() CreateInput { i := base; i.KodeMitra = "10"; return i }(), "kodeMitra: harus 3 digit angka")
	reject(t, func() CreateInput { i := base; i.KodeMitra = "abc"; return i }(), "kodeMitra: harus 3 digit angka")
	reject(t, func() CreateInput { i := base; i.Nama = " "; return i }(), "nama: wajib diisi")
	reject(t, func() CreateInput { i := base; i.PartnerServiceID = "     011"; return i }(), "partnerServiceId: harus kode mitra left-pad spasi ke 8 karakter, mis. \"     010\"")
	reject(t, func() CreateInput { i := base; i.PartnerServiceID = "    010"; return i }(), "partnerServiceId: harus kode mitra left-pad spasi ke 8 karakter, mis. \"     010\"")
	reject(t, func() CreateInput { i := base; i.VAPrefix = "01141"; return i }(), "vaPrefix: harus kode mitra diikuti literal \"41\", mis. \"01041\"")
	reject(t, func() CreateInput { i := base; i.VAPrefix = "0104"; return i }(), "vaPrefix: harus kode mitra diikuti literal \"41\", mis. \"01041\"")
	reject(t, func() CreateInput { i := base; i.BranchCode = " "; return i }(), "branchCode: wajib diisi")
	reject(t, func() CreateInput { i := base; i.RateLimitTier = "premium"; return i }(), "rateLimitTier: harus standard")
	base.CallbackUrl = strPtr("https://mitra.example.com/callback")
	if err := validateCreate(CreateInput{KodeMitra: "010", Nama: "Mitra", PartnerServiceID: "     010", VAPrefix: "01041", BranchCode: "001", CallbackUrl: strPtr("https://example.com/callback"), RateLimitTier: "standard", IPWhitelist: []string{"10.0.0.0/8"}, ConnectionType: domain.ConnectionPortalOnly}); err != nil {
		t.Fatalf("CIDR rejected: %v", err)
	}
	reject(t, func() CreateInput { i := base; i.IPWhitelist = []string{"not-an-ip"}; return i }(), "ipWhitelist: harus berisi alamat IP atau CIDR yang valid")

	badURL := "not-a-url"
	reject(t, func() CreateInput { i := base; i.CallbackUrl = &badURL; return i }(), "callbackUrl: wajib URL HTTPS yang valid")
	httpURL := "http://mitra.example.com/callback"
	reject(t, func() CreateInput { i := base; i.CallbackUrl = &httpURL; return i }(), "callbackUrl: wajib URL HTTPS yang valid")
	reject(t, func() CreateInput { i := base; i.CallbackUrl = nil; return i }(), "callbackUrl: wajib URL HTTPS yang valid")
}

func TestCreateDeliversCredentialsOnlyForHostToHost(t *testing.T) {
	for _, tc := range []struct {
		name            string
		connectionType  string
		wantCredentials bool
	}{
		{"portal", domain.ConnectionPortalOnly, false},
		{"host-to-host", domain.ConnectionHostToHost, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{}
			prov := &fakeProv{result: domain.ProvisionResult{
				PartnerID: "P-1", ClientID: "103", GatewayBaseURL: "https://gateway.example",
				ClientSecret: []byte("fixture-value"), PrivateKeyPEM: []byte("fixture-pem"),
			}}
			svc := &Service{Repo: repo, Tx: fakeTx{}, Prov: prov, SecretsDir: t.TempDir()}
			in := validCreateInput()
			in.ConnectionType = tc.connectionType
			result, err := svc.Create(context.Background(), in)
			if err != nil {
				t.Fatal(err)
			}
			if (result.Credentials != nil) != tc.wantCredentials {
				t.Fatalf("credentials present = %v, want %v", result.Credentials != nil, tc.wantCredentials)
			}
			if repo.mitra.CredentialsDelivered != tc.wantCredentials {
				t.Fatalf("credentialsDelivered = %v", repo.mitra.CredentialsDelivered)
			}
		})
	}
}

func TestRotateDeliversNewSecretOnlyForHostToHost(t *testing.T) {
	partnerID := "P-1"
	repo := &fakeRepo{mitra: domain.Mitra{ID: "m-1", KodeMitra: "103", Nama: "H2H", PartnerServiceID: "     103", VAPrefix: "10341", ProvisionPartnerID: &partnerID, ConnectionType: domain.ConnectionHostToHost}}
	prov := &fakeProv{rotate: domain.RotateResult{ClientSecret: []byte("rotated-fixture")}, privateKey: []byte("private-fixture")}
	svc := &Service{Repo: repo, Tx: fakeTx{}, Prov: prov}
	result, err := svc.RotateSecret(context.Background(), "m-1")
	if err != nil {
		t.Fatal(err)
	}
	if result.Credentials == nil || result.Credentials.PrivateKeyPEM != "private-fixture" || string(prov.replaced) != "rotated-fixture" {
		t.Fatalf("unexpected rotate result: %+v replaced=%q", result, prov.replaced)
	}
}

func strPtr(s string) *string { return &s }
