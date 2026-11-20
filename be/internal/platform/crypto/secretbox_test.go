package crypto

import (
	"testing"
)

func TestSecretBoxRoundTrip(t *testing.T) {
	box, err := NewSecretBox("test-encryption-key-do-not-use-in-production-32")
	if err != nil {
		t.Fatal(err)
	}
	plain := "hmac-secret-value"
	enc, err := box.Seal(plain)
	if err != nil {
		t.Fatal(err)
	}
	if enc == plain {
		t.Fatal("ciphertext equals plaintext")
	}
	out, err := box.Open(enc)
	if err != nil {
		t.Fatal(err)
	}
	if out != plain {
		t.Fatalf("decrypted = %q, want %q", out, plain)
	}
}

func TestSecretBoxRejectsTamperedCiphertext(t *testing.T) {
	box, err := NewSecretBox("test-encryption-key-do-not-use-in-production-32")
	if err != nil {
		t.Fatal(err)
	}
	enc, err := box.Seal("plaintext")
	if err != nil {
		t.Fatal(err)
	}
	raw := []byte(enc)
	raw[len(raw)-1] ^= 0xff // corrupt the last base64 character
	if _, err := box.Open(string(raw)); err == nil {
		t.Fatal("tampered ciphertext should not open")
	}
}

func TestSecretBoxEmptyKeyRejected(t *testing.T) {
	if _, err := NewSecretBox(""); err == nil {
		t.Fatal("empty key should be rejected")
	}
}

func TestSecretBoxDifferentKeysDiffer(t *testing.T) {
	b1, err := NewSecretBox("key-alpha-do-not-use-in-production-32")
	if err != nil {
		t.Fatal(err)
	}
	b2, err := NewSecretBox("key-beta-do-not-use-in-production-32")
	if err != nil {
		t.Fatal(err)
	}
	enc1, _ := b1.Seal("same plaintext")
	enc2, _ := b2.Seal("same plaintext")
	if enc1 == enc2 {
		t.Fatal("different keys should produce different ciphertext")
	}
}

func TestSecretBoxRandomIVDiffers(t *testing.T) {
	box, err := NewSecretBox("test-encryption-key-do-not-use-in-production-32")
	if err != nil {
		t.Fatal(err)
	}
	enc1, _ := box.Seal("same plaintext")
	enc2, _ := box.Seal("same plaintext")
	if enc1 == enc2 {
		t.Fatal("random IV should produce different ciphertext")
	}
}
