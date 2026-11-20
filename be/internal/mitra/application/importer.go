package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"govite/internal/platform/crypto"
)

// ImportBundles performs the one-time legacy migration. It verifies ciphertext
// by decrypting and comparing hashes before deleting any source file.
// secretsDir is intentionally accepted only by this migration utility; runtime
// provisioning and signing never read credential files.
func (s *Service) ImportBundles(ctx context.Context, secretsDir string) ([]string, []string, error) {
	entries, err := os.ReadDir(secretsDir)
	if err != nil {
		return nil, nil, err
	}
	var imported, needsRepair []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		kode := entry.Name()
		mitra, err := s.Repo.GetByKode(ctx, kode)
		if err != nil {
			needsRepair = append(needsRepair, kode)
			continue
		}
		partnerRaw, partnerErr := os.ReadFile(filepath.Join(secretsDir, kode, "partner.json"))
		hmacRaw, hmacErr := os.ReadFile(filepath.Join(secretsDir, kode, "hmac.secret"))
		privateRaw, privateErr := os.ReadFile(filepath.Join(secretsDir, kode, "private.pem"))
		if partnerErr != nil || hmacErr != nil || privateErr != nil || len(hmacRaw) == 0 || len(privateRaw) == 0 {
			detail := fmt.Sprintf("legacy bundle incomplete for %s", kode)
			_ = s.Repo.MarkNeedsRepair(ctx, mitra.ID, valueOrEmpty(mitra.ProvisionPartnerID), detail)
			needsRepair = append(needsRepair, kode)
			continue
		}
		var identity struct{ PartnerID, ClientID string }
		if err := json.Unmarshal(partnerRaw, &identity); err != nil || identity.PartnerID == "" || identity.ClientID == "" {
			_ = s.Repo.MarkNeedsRepair(ctx, mitra.ID, valueOrEmpty(mitra.ProvisionPartnerID), "legacy partner.json invalid")
			needsRepair = append(needsRepair, kode)
			continue
		}
		hmacEnc, err := crypto.EncryptWithSecretBox(s.Encryptor, string(hmacRaw))
		if err != nil {
			return imported, needsRepair, err
		}
		privateEnc, err := crypto.EncryptWithSecretBox(s.Encryptor, string(privateRaw))
		if err != nil {
			return imported, needsRepair, err
		}
		if err := s.Repo.SaveEncryptedCredentials(ctx, mitra.ID, hmacEnc, privateEnc); err != nil {
			needsRepair = append(needsRepair, kode)
			continue
		}
		checkH, err := crypto.DecryptWithSecretBox(s.Encryptor, hmacEnc)
		if err != nil || hash(checkH) != hash(string(hmacRaw)) {
			needsRepair = append(needsRepair, kode)
			continue
		}
		checkP, err := crypto.DecryptWithSecretBox(s.Encryptor, privateEnc)
		if err != nil || hash(checkP) != hash(string(privateRaw)) {
			needsRepair = append(needsRepair, kode)
			continue
		}
		for _, name := range []string{"partner.json", "hmac.secret", "private.pem"} {
			if err := os.Remove(filepath.Join(secretsDir, kode, name)); err != nil {
				return imported, needsRepair, err
			}
		}
		_ = os.Remove(filepath.Join(secretsDir, kode))
		imported = append(imported, kode)
	}
	return imported, needsRepair, nil
}

func hash(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func valueOrEmpty(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
