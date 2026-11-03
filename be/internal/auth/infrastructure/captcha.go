package infrastructure

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"govite/internal/kernel"
)

// captchaPrefix namespaces Redis keys so the in-memory and Redis stores never
// collide with limiter or cache keys.
const captchaPrefix = "captcha:"

// CaptchaRedis stores captcha hashes in Redis. Take is atomic: GETDEL removes
// the key even when several requests race, so a code can be spent only once.
type CaptchaRedis struct{ Client *redis.Client }

func (s CaptchaRedis) Put(ctx context.Context, id, hash string, ttl time.Duration) error {
	return s.Client.Set(ctx, captchaPrefix+id, hash, ttl).Err()
}

func (s CaptchaRedis) Take(ctx context.Context, id string) (string, error) {
	hash, err := s.Client.GetDel(ctx, captchaPrefix+id).Result()
	if err == redis.Nil {
		return "", kernel.ErrNotFound
	}
	return hash, err
}

// CaptchaMemory is the Redis-free fallback: a mutex-guarded map with a lazy
// sweep of expired entries on every write, following the repo's pattern of
// treating Redis as optional.
type CaptchaMemory struct {
	mu   sync.Mutex
	data map[string]captchaEntry
}

type captchaEntry struct {
	hash      string
	expiresAt time.Time
}

func NewCaptchaMemory() *CaptchaMemory {
	return &CaptchaMemory{data: make(map[string]captchaEntry)}
}

func (s *CaptchaMemory) Put(_ context.Context, id, hash string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	s.data[id] = captchaEntry{hash: hash, expiresAt: time.Now().Add(ttl)}
	return nil
}

func (s *CaptchaMemory) Take(_ context.Context, id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.data[id]
	if !ok {
		return "", kernel.ErrNotFound
	}
	// Delete on read: single use, whether valid or expired.
	delete(s.data, id)
	if time.Now().After(e.expiresAt) {
		return "", kernel.ErrNotFound
	}
	return e.hash, nil
}

// sweepLocked drops expired entries; called with s.mu held.
func (s *CaptchaMemory) sweepLocked() {
	now := time.Now()
	for id, e := range s.data {
		if now.After(e.expiresAt) {
			delete(s.data, id)
		}
	}
}
