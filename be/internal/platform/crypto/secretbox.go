// Package crypto provides AES-256-GCM encryption for at-rest secrets.
//
// SecretBox encrypts a single string value with a random 96-bit IV and
// returns base64url(iv || tag || ciphertext). The same layout is used by
// crypto.Keys so the two boxes are interoperable in format but keyed
// independently.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

// SecretBox encrypts and decrypts arbitrary strings with AES-256-GCM. The key
// is derived from the supplied passphrase with SHA-256. Zero value is not
// usable; use NewSecretBox.
type SecretBox struct {
	aead cipher.AEAD
}

// NewSecretBox derives a 256-bit key from key with SHA-256 and returns a box
// keyed by it. An empty key is an error.
func NewSecretBox(key string) (*SecretBox, error) {
	if key == "" {
		return nil, errors.New("secret encryption key is empty")
	}
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &SecretBox{aead: aead}, nil
}

// Seal encrypts plain and returns base64url(iv || tag || ciphertext). It never
// returns the plaintext.
func (b *SecretBox) Seal(plain string) (string, error) {
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := b.aead.Seal(nil, iv, []byte(plain), nil)
	ct, tag := sealed[:len(sealed)-16], sealed[len(sealed)-16:]
	return base64.RawURLEncoding.EncodeToString(append(append(iv, tag...), ct...)), nil
}

// Open decrypts ciphertext produced by Seal and returns the plaintext string.
func (b *SecretBox) Open(enc string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil || len(raw) < 28 {
		return "", errors.New("bad ciphertext")
	}
	iv, tag, ct := raw[:12], raw[12:28], raw[28:]
	out, err := b.aead.Open(nil, iv, append(append([]byte{}, ct...), tag...), nil)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// EncryptWithSecretBox seals plaintext with the box and returns the ciphertext
// string. It never logs the plaintext.
func EncryptWithSecretBox(box *SecretBox, plain string) (string, error) {
	return box.Seal(plain)
}

// DecryptWithSecretBox opens a ciphertext string produced by EncryptWithSecretBox
// and returns the plaintext, or an error.
func DecryptWithSecretBox(box *SecretBox, enc string) (string, error) {
	return box.Open(enc)
}
