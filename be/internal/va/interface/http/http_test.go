package http

import (
	"testing"
	"time"
)

func TestCreateInputValidationAndNormalization(t *testing.T) {
	now := time.Now()
	valid := createReq{CustomerNo: "123", TrxID: "INV-1", VirtualAccountName: "Budi", Amount: "100.00", Type: "F", ExpiredAt: now.Add(time.Hour).Format(time.RFC3339)}
	got, err := valid.input(now)
	if err != nil || got.CustomerNo != "00000000000123" {
		t.Fatalf("normalization: got=%q err=%v", got.CustomerNo, err)
	}
	cases := []createReq{
		{CustomerNo: "12A", TrxID: "INV-1", VirtualAccountName: "Budi", Amount: "100.00", Type: "F", ExpiredAt: valid.ExpiredAt},
		{CustomerNo: "123456789012345", TrxID: "INV-1", VirtualAccountName: "Budi", Amount: "100.00", Type: "F", ExpiredAt: valid.ExpiredAt},
		{CustomerNo: "123", TrxID: "INV-12345678901234567890", VirtualAccountName: "Budi", Amount: "100.00", Type: "F", ExpiredAt: valid.ExpiredAt},
		{CustomerNo: "123", TrxID: "INV-1", VirtualAccountName: "Budi", Amount: "100", Type: "F", ExpiredAt: valid.ExpiredAt},
		{CustomerNo: "123", TrxID: "INV-1", VirtualAccountName: "Budi", Amount: "100.00", Type: "F", ExpiredAt: now.Add(-time.Hour).Format(time.RFC3339)},
	}
	for i, tc := range cases {
		if _, err := tc.input(now); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}
