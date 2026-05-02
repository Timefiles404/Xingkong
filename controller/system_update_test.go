package controller

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdateComposeServiceImage(t *testing.T) {
	dir := t.TempDir()
	composeFile := filepath.Join(dir, "docker-compose.yml")
	content := strings.Join([]string{
		"services:",
		"  db:",
		"    image: postgres:18-alpine",
		"  app:",
		"    image: old-image:latest",
		"    environment:",
		"      - FOO=bar",
		"  uptime-kuma:",
		"    image: louislam/uptime-kuma:1",
		"",
	}, "\n")
	if err := os.WriteFile(composeFile, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := updateComposeServiceImage(composeFile, "app", "ghcr.io/timefiles404/xingkong:v1.2.3"); err != nil {
		t.Fatal(err)
	}

	updatedBytes, err := os.ReadFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	updated := string(updatedBytes)
	if !strings.Contains(updated, "    image: ghcr.io/timefiles404/xingkong:v1.2.3") {
		t.Fatalf("app image was not updated:\n%s", updated)
	}
	if !strings.Contains(updated, "    image: postgres:18-alpine") {
		t.Fatalf("db image should not be changed:\n%s", updated)
	}
	if !strings.Contains(updated, "    image: louislam/uptime-kuma:1") {
		t.Fatalf("uptime image should not be changed:\n%s", updated)
	}
}

func TestIsNewerVersion(t *testing.T) {
	cases := []struct {
		current string
		latest  string
		want    bool
	}{
		{current: "v1.2.0", latest: "v1.2.1", want: true},
		{current: "v1.2.1", latest: "v1.2.1", want: false},
		{current: "v1.3.0", latest: "v1.2.9", want: false},
		{current: "main-b2232f4", latest: "v1.0.0", want: true},
		{current: "checkpoint-base-goal-complete-20260501-snapshot", latest: "v1.0.0", want: true},
	}
	for _, tt := range cases {
		if got := isNewerVersion(tt.current, tt.latest); got != tt.want {
			t.Fatalf("isNewerVersion(%q, %q) = %v, want %v", tt.current, tt.latest, got, tt.want)
		}
	}
}
