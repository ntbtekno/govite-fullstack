//go:build ignore

package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/admin/v1/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/admin/v1/partners/") && strings.HasSuffix(r.URL.Path, "/rotate-secret") {
			write(w, map[string]any{"clientSecret": "e2e-rotated-hmac-secret"})
			return
		}
		if r.URL.Path != "/admin/v1/partners" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			ClientID string `json:"clientId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		write(w, map[string]any{"partnerId": "e2e-provisioned", "clientId": body.ClientID, "clientSecret": "e2e-provisioning-secret"})
	})
	// Test double for the confirmed gateway endpoint:
	// POST /admin/v1/partners/{partnerId}/rotate-secret.
	mux.HandleFunc("/api/v1.0/access-token/b2b", func(w http.ResponseWriter, _ *http.Request) {
		write(w, map[string]any{"responseCode": "2007300", "responseMessage": "Successful", "accessToken": "e2e-token", "tokenType": "Bearer", "expiresIn": 900})
	})
	mux.HandleFunc("/api/v1.0/transfer-va/create-va", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		write(w, map[string]any{"responseCode": "2002700", "responseMessage": "Successful", "virtualAccountData": map[string]any{
			"partnerServiceId": "     010", "customerNo": body["customerNo"], "virtualAccountNo": "     0104100000000000123",
			"virtualAccountName": body["virtualAccountName"], "trxId": body["trxId"], "status": "ACTIVE", "referenceNo": "",
		}})
	})
	if err := http.ListenAndServe(":18080", mux); err != nil {
		_, _ = os.Stderr.WriteString(err.Error())
	}
}

func write(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}
