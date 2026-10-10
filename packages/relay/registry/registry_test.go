package registry_test

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/Rinai-R/kivotos/packages/relay/registry"
	"github.com/Rinai-R/kivotos/packages/relay/wire"
)

func newRegistration(t *testing.T) wire.Registration {
	t.Helper()
	random := func(n int) string {
		raw := make([]byte, n)
		rand.Read(raw)
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	reg, err := wire.ParseRegistration(random(16) + "." + random(32))
	if err != nil {
		t.Fatal(err)
	}
	return reg
}

func TestNetworksSurviveRestartAndKeepTheirOwnTokens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.json")
	home, other := newRegistration(t), newRegistration(t)

	r, err := registry.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, reg := range []wire.Registration{home, other} {
		if err := r.Add(reg, "home"); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Add(home, "again"); !errors.Is(err, registry.ErrExists) {
		t.Fatalf("registering twice: err = %v, want ErrExists", err)
	}

	r, err = registry.Open(path)
	if err != nil {
		t.Fatalf("reopening: %v", err)
	}
	if !r.Member(home.Network, home.Token) {
		t.Fatal("network was lost across a restart")
	}
	if r.Member(home.Network, other.Token) {
		t.Fatal("one network's token was accepted for another")
	}

	if err := r.Remove(home.Network); err != nil {
		t.Fatal(err)
	}
	if r.Member(home.Network, home.Token) {
		t.Fatal("removed network is still admitted")
	}
	if err := r.Remove(home.Network); !errors.Is(err, registry.ErrNotFound) {
		t.Fatalf("removing twice: err = %v, want ErrNotFound", err)
	}
}

func TestTheTokenIsNotWrittenToDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.json")
	r, err := registry.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg := newRegistration(t)
	if err := r.Add(reg, "home"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte(reg.Token)) {
		t.Fatal("registry file contains the token itself")
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("registry file mode = %v, want 0600", info.Mode().Perm())
	}
}

func TestOpenRejectsACorruptRegistry(t *testing.T) {
	for i, content := range []string{`{"networks": [`, `{"networks":[{"id":"x"}]}`} {
		path := filepath.Join(t.TempDir(), fmt.Sprintf("registry-%d.json", i))
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := registry.Open(path); err == nil {
			t.Errorf("Open accepted %q", content)
		}
	}
}
