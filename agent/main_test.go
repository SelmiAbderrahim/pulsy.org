package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProtectedConfiguration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	config := configuration{Origin: "https://example.invalid", Token: strings.Repeat("a", 43)}
	write := func(c configuration, mode os.FileMode) {
		data, _ := json.Marshal(c)
		if err := os.WriteFile(path, data, mode); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, mode); err != nil {
			t.Fatal(err)
		}
	}
	write(config, 0600)
	result, err := readConfiguration(path)
	if err != nil || result.Interval != 60 || result.Proc != "/proc" {
		t.Fatal(result, err)
	}
	write(config, 0644)
	if _, err := readConfiguration(path); err == nil {
		t.Fatal("world-readable credentials accepted")
	}
	for _, origin := range []string{"http://example.invalid", "https://secret@example.invalid", "https://example.invalid/path", "https://example.invalid?token=a"} {
		config.Origin = origin
		write(config, 0600)
		if _, err := readConfiguration(path); err == nil || strings.Contains(err.Error(), config.Token) {
			t.Fatal("invalid origin or leaked secret")
		}
	}
	config.Origin = "https://example.invalid"
	config.Interval = 1
	write(config, 0600)
	if _, err := readConfiguration(path); err == nil {
		t.Fatal("invalid interval accepted")
	}
	link := path + "-link"
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readConfiguration(link); err == nil {
		t.Fatal("symlink accepted")
	}
}
func TestReporterTLSRetriesAndBoundedResponse(t *testing.T) {
	attempts := 0
	token := strings.Repeat("a", 43)
	payload := sample{Version: 1, Filesystems: []filesystem{}}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Path != "/api/agent/v1/metrics" || r.URL.RawQuery != "" {
			t.Error("invalid auth boundary")
		}
		if attempts < 3 {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"outcome":"accepted","interval":300,"excludedFilesystems":[]}`))
	}))
	defer server.Close()
	reporter := newReporter(configuration{Origin: server.URL, Token: token})
	reporter.sleep = func(context.Context, time.Duration) error { return nil }
	reporter.jitter = func() time.Duration { return 0 }
	if _, err := reporter.report(context.Background(), payload); err == nil {
		t.Fatal("untrusted TLS accepted")
	}
	attempts = 0
	reporter.client = server.Client()
	result, err := reporter.report(context.Background(), payload)
	if err != nil || attempts != 3 || result.Interval != 300 {
		t.Fatal(attempts, result, err)
	}
}
func TestReporterRejectsMalformedResponsesAndNeverFollowsRedirects(t *testing.T) {
	for _, response := range []string{"{", `{"outcome":"accepted","interval":1}`, `{"outcome":"accepted","interval":60,"padding":"` + strings.Repeat("a", maxReceiptBytes) + `"}`} {
		server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(response)) }))
		reporter := newReporter(configuration{Origin: server.URL, Token: strings.Repeat("a", 43)})
		reporter.client = server.Client()
		_, err := reporter.report(context.Background(), sample{})
		server.Close()
		if err == nil {
			t.Fatal("malformed response accepted")
		}
	}
	requests := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; http.Redirect(w, r, "/steal", 302) }))
	defer server.Close()
	reporter := newReporter(configuration{Origin: server.URL, Token: strings.Repeat("a", 43)})
	reporter.client.Transport = server.Client().Transport
	if _, err := reporter.report(context.Background(), sample{}); err == nil || requests != 1 {
		t.Fatal("redirect followed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if wait(ctx, time.Hour) == nil {
		t.Fatal("shutdown ignored")
	}
}

func TestReporterAcceptsMaximumExclusionList(t *testing.T) {
	exclusions := make([]string, 32)
	for i := range exclusions {
		exclusions[i] = "/" + strings.Repeat("\\", 508) + fmt.Sprintf("%03d", i)
	}
	body, err := json.Marshal(receipt{Outcome: "accepted", Interval: 300, Excludes: exclusions})
	if err != nil || len(body) <= 8192 {
		t.Fatal("fixture does not exercise a large valid reply")
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(body) }))
	defer server.Close()
	reporter := newReporter(configuration{Origin: server.URL, Token: strings.Repeat("a", 43)})
	reporter.client = server.Client()
	response, err := reporter.report(context.Background(), sample{})
	if err != nil || response.Interval != 300 || len(response.Excludes) != 32 {
		t.Fatal("valid maximum exclusions rejected", err)
	}
}

func TestFilesystemPathProtocolBoundary(t *testing.T) {
	for _, path := range []string{"/", "/" + strings.Repeat("é", 255)} {
		if !validFilesystemPath(path) {
			t.Fatal("valid byte-bounded path rejected")
		}
	}
	for _, path := range []string{"relative", "/" + strings.Repeat("é", 256), "/bad\x1b", "/bad\x7f"} {
		if validFilesystemPath(path) {
			t.Fatal("unsupported path accepted")
		}
	}
}
