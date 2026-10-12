package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

// binary stands in for the relay executable sitting in the working directory.
var binary = []byte("\x7fELF\x02\x01\x01\x00\xff\xfe\xfd")

func TestInitConfig(t *testing.T) {
	tests := []struct {
		name    string
		files   map[string][]byte
		args    []string
		listen  string
		wantErr bool
	}{
		{
			name:   "binary named like the config is not read",
			files:  map[string][]byte{"kivotos-relay": binary},
			listen: ":7443",
		},
		{
			name:   "default file is read next to the binary",
			files:  map[string][]byte{"kivotos-relay": binary, "kivotos-relay.yaml": []byte("listen: \":9999\"\n")},
			listen: ":9999",
		},
		{
			name:    "named file must exist",
			args:    []string{"--config", "missing.yaml"},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			for name, body := range tt.files {
				if err := os.WriteFile(filepath.Join(dir, name), body, 0o755); err != nil {
					t.Fatal(err)
				}
			}
			t.Chdir(dir)
			cmd := NewRootCmd()
			if err := cmd.ParseFlags(tt.args); err != nil {
				t.Fatal(err)
			}
			v := viper.New()
			err := initConfig(v, cmd)
			if tt.wantErr {
				if err == nil {
					t.Fatal("initConfig succeeded, want an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("initConfig: %v", err)
			}
			if got := v.GetString("listen"); got != tt.listen {
				t.Errorf("listen = %q, want %q", got, tt.listen)
			}
		})
	}
}
