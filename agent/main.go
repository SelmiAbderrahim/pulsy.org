package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

var bootPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

type configuration struct {
	Origin   string   `json:"origin"`
	Token    string   `json:"token"`
	Proc     string   `json:"proc"`
	Root     string   `json:"root"`
	Interval int      `json:"interval"`
	Excludes []string `json:"excludedFilesystems"`
}

func readConfiguration(path string) (configuration, error) {
	var config configuration
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return config, errors.New("configuration must be a regular file accessible only to its owner (0600)")
	}
	data, err := boundedRead(path, 16384)
	if err != nil {
		return config, errors.New("cannot read configuration")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&config) != nil {
		return config, errors.New("invalid configuration")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return config, errors.New("invalid configuration")
	}
	origin, err := url.Parse(config.Origin)
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		return config, errors.New("origin must be an HTTPS origin without credentials, path, query or fragment")
	}
	if !tokenPattern.MatchString(config.Token) {
		return config, errors.New("invalid agent credential")
	}
	config.Origin = strings.TrimSuffix(config.Origin, "/")
	if config.Proc == "" {
		config.Proc = "/proc"
	}
	if config.Root == "" {
		config.Root = "/"
	}
	if config.Interval == 0 {
		config.Interval = 60
	}
	if !filepath.IsAbs(config.Proc) || !filepath.IsAbs(config.Root) || config.Interval < 60 || config.Interval > 3600 || len(config.Excludes) > 32 {
		return config, errors.New("invalid collection configuration")
	}
	for _, path := range config.Excludes {
		if !validFilesystemPath(path) {
			return config, errors.New("invalid filesystem exclusion")
		}
	}
	return config, nil
}

// Covers 32 maximum-length exclusions, including JSON escaping, while bounded.
const maxReceiptBytes = 48 * 1024

type receipt struct {
	Outcome  string   `json:"outcome"`
	Interval int      `json:"interval"`
	Excludes []string `json:"excludedFilesystems"`
}
type reporter struct {
	client        *http.Client
	origin, token string
	sleep         func(context.Context, time.Duration) error
	jitter        func() time.Duration
}

func wait(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func newReporter(config configuration) *reporter {
	return &reporter{client: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConns: 1, MaxIdleConnsPerHost: 1, IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 5 * time.Second}}, origin: config.Origin, token: config.Token, sleep: wait, jitter: func() time.Duration { return time.Duration(rand.IntN(1000)) * time.Millisecond }}
}
func (r *reporter) report(ctx context.Context, value sample) (receipt, error) {
	var result receipt
	body, err := json.Marshal(value)
	if err != nil || len(body) > 48*1024 {
		return result, errors.New("invalid metric sample")
	}
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			if err := r.sleep(ctx, time.Duration(1<<attempt)*time.Second+r.jitter()); err != nil {
				return result, err
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.origin+"/api/agent/v1/metrics", bytes.NewReader(body))
		if err != nil {
			return result, errors.New("invalid endpoint")
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+r.token)
		req.Header.Set("User-Agent", "pulsy-agent/"+version)
		response, err := r.client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, maxReceiptBytes+1))
		response.Body.Close()
		if response.StatusCode == http.StatusUnauthorized {
			return result, errors.New("agent credential rejected; rotate or update the protected configuration")
		}
		if response.StatusCode == http.StatusTooManyRequests {
			if readErr == nil && len(data) <= maxReceiptBytes && json.Unmarshal(data, &result) == nil && validReceipt(result) {
				return result, nil
			}
			return receipt{}, errors.New("report rate limited")
		}
		if response.StatusCode >= 500 {
			continue
		}
		if response.StatusCode != 200 || readErr != nil || len(data) > maxReceiptBytes || json.Unmarshal(data, &result) != nil || !validReceipt(result) || (result.Outcome != "accepted" && result.Outcome != "ignored") {
			return receipt{}, errors.New("invalid metrics response")
		}
		return result, nil
	}
	return result, errors.New("report unavailable after bounded retries")
}
func validFilesystemPath(path string) bool {
	if !filepath.IsAbs(path) || len(path) > 512 {
		return false
	}
	for _, character := range path {
		if character < 32 || character == 127 {
			return false
		}
	}
	return true
}
func validReceipt(value receipt) bool {
	if value.Interval < 60 || value.Interval > 3600 || len(value.Excludes) > 32 {
		return false
	}
	for _, path := range value.Excludes {
		if !validFilesystemPath(path) {
			return false
		}
	}
	return true
}
func run(ctx context.Context, config configuration) {
	collector := &collector{proc: config.Proc, root: config.Root, excludes: config.Excludes}
	reporter := newReporter(config)
	defer reporter.client.CloseIdleConnections()
	interval := time.Duration(config.Interval) * time.Second
	for {
		value, err := collector.collect(time.Now())
		if err == nil {
			var response receipt
			response, err = reporter.report(ctx, value)
			if err == nil {
				interval = time.Duration(response.Interval) * time.Second
				collector.excludes = response.Excludes
			}
		}
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "pulsy-agent:", err)
		}
		if wait(ctx, interval) != nil {
			return
		}
	}
}
func main() {
	path := flag.String("config", "/etc/pulsy-agent/config.json", "protected configuration file")
	showVersion := flag.Bool("version", false, "print version")
	check := flag.Bool("check-config", false, "validate configuration without reporting")
	once := flag.Bool("collect-once", false, "print one metric sample without reporting")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	config, err := readConfiguration(*path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pulsy-agent:", err)
		os.Exit(1)
	}
	if *check {
		return
	}
	if *once {
		value, err := (&collector{proc: config.Proc, root: config.Root, excludes: config.Excludes}).collect(time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "pulsy-agent:", err)
			os.Exit(1)
		}
		if json.NewEncoder(os.Stdout).Encode(value) != nil {
			os.Exit(1)
		}
		return
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	run(ctx, config)
}
