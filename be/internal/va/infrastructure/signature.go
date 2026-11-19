package infrastructure

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"
)

// wita is the gateway timezone: WITA (GMT+8). The offset is written literally
// as +08:00 and the format carries no milliseconds (spec Bagian 4.3).
var wita = time.FixedZone("WITA", 8*60*60)

// timestampFormat is ISO 8601 WITA without milliseconds, e.g.
// 2026-11-12T16:20:00+08:00.
const timestampFormat = "2006-01-02T15:04:05+08:00"

// nowTimestamp is the clock the client uses; a test can override it to pin the
// timestamp (and therefore the signature) to a fixed value.
var nowTimestamp = func() string { return time.Now().In(wita).Format(timestampFormat) }

// minify removes insignificant whitespace outside JSON string values only:
// spaces, tabs and newlines between tokens. Key order is preserved, whitespace
// inside string values is untouched, and numbers are never re-normalised. The
// safest caller serialises once and signs the very same string it sends.
func minify(raw string) string {
	var b strings.Builder
	b.Grow(len(raw))
	inString, escaped := false, false
	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if inString {
			b.WriteByte(ch)
			switch {
			case escaped:
				escaped = false
			case ch == '\\':
				escaped = true
			case ch == '"':
				inString = false
			}
			continue
		}
		switch ch {
		case '"':
			inString = true
			b.WriteByte(ch)
		case ' ', '\t', '\r', '\n':
			// skip whitespace outside strings
		default:
			b.WriteByte(ch)
		}
	}
	return b.String()
}

// bodyHash is the lowercase hex SHA-256 of the minified body (spec Bagian 4.2
// step 2).
func bodyHash(minified string) string {
	sum := sha256.Sum256([]byte(minified))
	return hex.EncodeToString(sum[:])
}

// businessStringToSign joins the fixed pieces the spec signs for Create VA:
// METHOD:PATH:accessToken:bodyHash:timestamp (spec Bagian 4.2 step 3).
func businessStringToSign(method, path, accessToken, hash, timestamp string) string {
	return method + ":" + path + ":" + accessToken + ":" + hash + ":" + timestamp
}

// hmacSHA512Base64 is the business X-SIGNATURE: Base64(HMAC-SHA512(...)).
func hmacSHA512Base64(secret, stringToSign string) string {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// tokenStringToSign is clientId|timestamp, the string the RSA token signature
// covers (spec Bagian 4.1).
func tokenStringToSign(clientID, timestamp string) string {
	return clientID + "|" + timestamp
}

// padLeft left-pads s with spaces to width n. If s is already at least n bytes
// it is returned unchanged (the gateway rejects over-length fields; padding
// must never truncate a caller's value).
func padLeft(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return strings.Repeat(" ", n-len(s)) + s
}
