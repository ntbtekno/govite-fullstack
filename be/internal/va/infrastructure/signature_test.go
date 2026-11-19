package infrastructure

import "testing"

// vectorBody is the §4.4 example body (already minified), and vectorHash its
// documented SHA-256. A mismatch means minify or hashing changed the bytes and
// must be fixed on the portal side, not worked around.
const (
	vectorBody = `{"partnerServiceId":"     010","customerNo":"20261023000001","virtualAccountNo":"     20261023000001","virtualAccountName":"Budi Santoso","trxId":"INV-2026-000001","totalAmount":{"value":"150000.00","currency":"IDR"},"virtualAccountTrxType":"F","expiredDate":"2026-12-31T23:59:59+08:00","additionalInfo":{"description":"Tagihan SPP","phone":"+6281234567890"}}`
	vectorHash = "de0a89c2f214065d6798800d05c56a2544ef3c6c62edbeed8f350008df081118"
)

// TestVectorHashMatchesSpec pins the §4.4 test vector: the portal's minify and
// SHA-256 must reproduce the documented hash exactly.
func TestVectorHashMatchesSpec(t *testing.T) {
	if got := bodyHash(minify(vectorBody)); got != vectorHash {
		t.Fatalf("body hash = %s, want %s", got, vectorHash)
	}
}

// TestMinifyPreservesKeyOrderAndStringWhitespace proves minify strips whitespace
// outside strings only and leaves key order and in-string spaces untouched.
func TestMinifyPreservesKeyOrderAndStringWhitespace(t *testing.T) {
	raw := "{\n  \"b\" : 1 ,\t\"a\": \"x  y\"\r\n}"
	want := `{"b":1,"a":"x  y"}`
	if got := minify(raw); got != want {
		t.Fatalf("minify = %q, want %q", got, want)
	}
}

// TestMinifyEscapedQuoteKeepsStringOpen guards the escape state machine: a \"
// inside a string must not be treated as the closing quote.
func TestMinifyEscapedQuoteKeepsStringOpen(t *testing.T) {
	raw := `{"a":"he said \"hi\"  there"}`
	want := `{"a":"he said \"hi\"  there"}`
	if got := minify(raw); got != want {
		t.Fatalf("minify = %q, want %q", got, want)
	}
}

// TestBodyHashLowercaseHex proves the hex is 64 lowercase characters.
func TestBodyHashLowercaseHex(t *testing.T) {
	got := bodyHash(minify(vectorBody))
	if len(got) != 64 {
		t.Fatalf("hash length = %d, want 64", len(got))
	}
	for _, c := range got {
		if !(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f') {
			t.Fatalf("hash %s contains non-lowercase-hex rune %q", got, c)
		}
	}
}

// TestBusinessSignatureDeterministic pins that a fixed input yields a fixed
// Base64 HMAC-SHA512, and that changing one body byte changes the signature.
func TestBusinessSignatureDeterministic(t *testing.T) {
	method, path := "POST", createPath
	token := "test-token"
	ts := "2026-11-12T16:20:00+08:00"

	sig1 := hmacSHA512Base64(testHMACSecret, businessStringToSign(method, path, token, bodyHash(minify(vectorBody)), ts))
	sig2 := hmacSHA512Base64(testHMACSecret, businessStringToSign(method, path, token, bodyHash(minify(vectorBody)), ts))
	if sig1 != sig2 {
		t.Fatalf("signature not deterministic: %s vs %s", sig1, sig2)
	}

	// Change one byte of the body: the hash (and therefore the signature) must differ.
	modified := vectorBody[:10] + "X" + vectorBody[11:]
	sig3 := hmacSHA512Base64(testHMACSecret, businessStringToSign(method, path, token, bodyHash(minify(modified)), ts))
	if sig3 == sig1 {
		t.Fatal("signature did not change when the body changed")
	}
}

// TestTokenStringToSign proves the token signature input is clientId|timestamp.
func TestTokenStringToSign(t *testing.T) {
	if got := tokenStringToSign("010", "2026-11-12T16:20:00+08:00"); got != "010|2026-11-12T16:20:00+08:00" {
		t.Fatalf("tokenStringToSign = %q", got)
	}
}

// TestPadLeft proves partnerServiceId pads to 8 and customerNo to 19.
func TestPadLeft(t *testing.T) {
	if got := padLeft("010", 8); got != "     010" {
		t.Fatalf("padLeft(010,8) = %q", got)
	}
	if got := padLeft("20261023000001", 19); got != "     20261023000001" {
		t.Fatalf("padLeft(customerNo,19) = %q", got)
	}
	// An already-over-length value is returned unchanged, never truncated.
	if got := padLeft("123456789012345678901", 19); got != "123456789012345678901" {
		t.Fatalf("over-length value must not be truncated, got %q", got)
	}
}

// TestTimestampFormatIsWITAWithoutMillis pins the WITA offset and the absence
// of milliseconds.
func TestTimestampFormatIsWITAWithoutMillis(t *testing.T) {
	if got := nowTimestamp(); len(got) != len("2026-11-12T16:20:00+08:00") {
		t.Fatalf("timestamp %q has wrong length", got)
	}
	if !hasSuffix(nowTimestamp(), "+08:00") {
		t.Fatalf("timestamp %q must carry the +08:00 offset", nowTimestamp())
	}
}

func hasSuffix(s, suffix string) bool {
	return len(s) >= len(suffix) && s[len(s)-len(suffix):] == suffix
}
