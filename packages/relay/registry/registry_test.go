package registry_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/Rinai-R/kivotos/packages/relay/registry"
	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

func newKey(t *testing.T) wire.Key {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return wire.NewKey(pub)
}

func TestGrantsSurviveRestartAndFollowTheirHost(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.json")
	host, other, phone := newKey(t), newKey(t), newKey(t)

	r, err := registry.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range []wire.Key{host, other} {
		if err := r.AddHost(h, "desk"); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Grant(host, phone, "phone"); err != nil {
		t.Fatal(err)
	}
	if err := r.AddHost(host, "again"); !errors.Is(err, registry.ErrHostExists) {
		t.Fatalf("enrolling twice: err = %v, want ErrHostExists", err)
	}

	r, err = registry.Open(path)
	if err != nil {
		t.Fatalf("reopening: %v", err)
	}
	if !r.ClientAllowed(host, phone) {
		t.Fatal("grant was lost across a restart")
	}
	if r.ClientAllowed(other, phone) {
		t.Fatal("a grant on one host let the device reach another")
	}

	if err := r.RemoveHost(host); err != nil {
		t.Fatal(err)
	}
	if r.HostKnown(host) || r.ClientAllowed(host, phone) {
		t.Fatal("removed host or its grant is still honored")
	}
	if err := r.Grant(host, phone, ""); !errors.Is(err, registry.ErrHostNotFound) {
		t.Fatalf("granting on a removed host: err = %v, want ErrHostNotFound", err)
	}
}

func TestHostCannotGrantWithoutBound(t *testing.T) {
	r, err := registry.Open(filepath.Join(t.TempDir(), "registry.json"))
	if err != nil {
		t.Fatal(err)
	}
	host := newKey(t)
	if err := r.AddHost(host, ""); err != nil {
		t.Fatal(err)
	}
	first := newKey(t)
	if err := r.Grant(host, first, ""); err != nil {
		t.Fatal(err)
	}
	for range registry.MaxClientsPerHost - 1 {
		if err := r.Grant(host, newKey(t), ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Grant(host, newKey(t), ""); !errors.Is(err, registry.ErrTooMany) {
		t.Fatalf("grant past the limit: err = %v, want ErrTooMany", err)
	}
	// Renaming a device already granted is not a new grant.
	if err := r.Grant(host, first, "renamed"); err != nil {
		t.Fatalf("re-granting at the limit: %v", err)
	}
}

func TestOpenRejectsACorruptRegistry(t *testing.T) {
	for i, content := range []string{`{"hosts": [`, `{"hosts":[{"key":"not a key"}]}`} {
		path := filepath.Join(t.TempDir(), fmt.Sprintf("registry-%d.json", i))
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := registry.Open(path); err == nil {
			t.Errorf("Open accepted %q", content)
		}
	}
}
