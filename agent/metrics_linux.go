package main

import (
	"bufio"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const version = "1.0.0"

type agentInfo struct {
	Version string `json:"version"`
	Arch    string `json:"arch"`
}
type filesystem struct {
	Path string   `json:"path"`
	Used *float64 `json:"usedPercent"`
}
type sample struct {
	Version     int          `json:"version"`
	BootID      string       `json:"bootId"`
	Sequence    int64        `json:"sequence"`
	SampledAt   string       `json:"sampledAt"`
	Agent       agentInfo    `json:"agent"`
	CPU         *float64     `json:"cpuPercent"`
	Memory      *float64     `json:"memoryPercent"`
	Swap        *float64     `json:"swapPercent"`
	Load        *[3]float64  `json:"load"`
	Uptime      *float64     `json:"uptimeSeconds"`
	Filesystems []filesystem `json:"filesystems"`
}
type cpuCounters struct{ total, idle uint64 }
type collector struct {
	proc, root string
	previous   *cpuCounters
	boot       string
	excludes   []string
	statfs     func(string, *syscall.Statfs_t) error
}

func boundedRead(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if int64(len(data)) > limit {
		return nil, errors.New("file exceeds collection limit")
	}
	return data, err
}
func parseCPU(data string) *cpuCounters {
	fields := strings.Fields(strings.SplitN(data, "\n", 2)[0])
	if len(fields) < 9 || fields[0] != "cpu" {
		return nil
	}
	var counters cpuCounters
	// guest/guest_nice are already included in user/nice. Count the first 8 only.
	for i, field := range fields[1:9] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil || math.MaxUint64-counters.total < value {
			return nil
		}
		counters.total += value
		if i == 3 || i == 4 {
			counters.idle += value
		}
	}
	return &counters
}
func cpuPercent(previous, current *cpuCounters) *float64 {
	if previous == nil || current == nil || current.total <= previous.total || current.idle < previous.idle {
		return nil
	}
	total, idle := current.total-previous.total, current.idle-previous.idle
	if idle > total {
		return nil
	}
	value := 100 * float64(total-idle) / float64(total)
	return &value
}
func memoryPercent(data string) (*float64, *float64) {
	values := make(map[string]uint64)
	scanner := bufio.NewScanner(strings.NewReader(data))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 3 || fields[2] != "kB" {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			values[strings.TrimSuffix(fields[0], ":")] = value
		}
	}
	ratio := func(totalKey, freeKey string) *float64 {
		total, ok := values[totalKey]
		free, available := values[freeKey]
		if !ok || !available || total == 0 || free > total {
			return nil
		}
		value := 100 * float64(total-free) / float64(total)
		return &value
	}
	return ratio("MemTotal", "MemAvailable"), ratio("SwapTotal", "SwapFree")
}
func number(value string) *float64 {
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < 0 || parsed > 9007199254740991 {
		return nil
	}
	return &parsed
}
func (c *collector) collect(now time.Time) (sample, error) {
	result := sample{Version: 1, Sequence: now.UnixMilli(), SampledAt: now.UTC().Format(time.RFC3339Nano), Agent: agentInfo{version, runtime.GOARCH}, Filesystems: []filesystem{}}
	boot, err := boundedRead(filepath.Join(c.proc, "sys/kernel/random/boot_id"), 128)
	if err != nil || !bootPattern.MatchString(strings.TrimSpace(string(boot))) {
		return result, errors.New("host boot identity unavailable")
	}
	result.BootID = strings.TrimSpace(string(boot))
	if c.boot != result.BootID {
		c.previous = nil
		c.boot = result.BootID
	}
	cpu, err := boundedRead(filepath.Join(c.proc, "stat"), 1024*1024)
	var current *cpuCounters
	if err == nil {
		current = parseCPU(string(cpu))
	}
	result.CPU = cpuPercent(c.previous, current)
	c.previous = current
	if memory, err := boundedRead(filepath.Join(c.proc, "meminfo"), 65536); err == nil {
		result.Memory, result.Swap = memoryPercent(string(memory))
	}
	if load, err := boundedRead(filepath.Join(c.proc, "loadavg"), 1024); err == nil {
		fields := strings.Fields(string(load))
		if len(fields) >= 3 {
			a, b, d := number(fields[0]), number(fields[1]), number(fields[2])
			if a != nil && b != nil && d != nil {
				result.Load = &[3]float64{*a, *b, *d}
			}
		}
	}
	if uptime, err := boundedRead(filepath.Join(c.proc, "uptime"), 1024); err == nil {
		fields := strings.Fields(string(uptime))
		if len(fields) > 0 {
			result.Uptime = number(fields[0])
		}
	}
	// Read only mount metadata, never process arguments or environments.
	if mounts, err := boundedRead(filepath.Join(c.proc, "1/mountinfo"), 2*1024*1024); err == nil {
		result.Filesystems = c.filesystems(string(mounts))
	}
	return result, nil
}
func diskPercent(stat syscall.Statfs_t) *float64 {
	if stat.Blocks == 0 || stat.Bfree > stat.Blocks || stat.Bavail > stat.Bfree {
		return nil
	}
	used := stat.Blocks - stat.Bfree
	denominator := float64(used) + float64(stat.Bavail)
	if denominator == 0 {
		return nil
	}
	value := 100 * float64(used) / denominator
	return &value
}
func (c *collector) filesystems(mounts string) []filesystem {
	result := []filesystem{}
	seen := map[string]bool{}
	excluded := func(path string) bool {
		for _, prefix := range append([]string{"/proc", "/sys", "/dev", "/run", "/var/lib/docker", "/var/lib/containers", "/snap"}, c.excludes...) {
			if path == prefix || strings.HasPrefix(path, strings.TrimSuffix(prefix, "/")+"/") {
				return true
			}
		}
		return false
	}
	scanner := bufio.NewScanner(strings.NewReader(mounts))
	scanner.Buffer(make([]byte, 4096), 65536)
	unescape := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)
	for scanner.Scan() {
		parts := strings.SplitN(scanner.Text(), " - ", 2)
		if len(parts) != 2 {
			continue
		}
		left, right := strings.Fields(parts[0]), strings.Fields(parts[1])
		if len(left) < 5 || len(right) < 2 {
			continue
		}
		path := unescape.Replace(left[4])
		kind := right[0]
		if !validFilesystemPath(path) || filepath.Clean(path) != path || excluded(path) || seen[path] {
			continue
		}
		// Exclude virtual/container mounts; keep a root overlay for disposable Linux fixtures.
		switch kind {
		case "proc", "sysfs", "tmpfs", "devtmpfs", "devpts", "cgroup", "cgroup2", "squashfs", "securityfs", "debugfs", "tracefs", "fusectl", "mqueue", "hugetlbfs", "autofs", "rpc_pipefs", "configfs", "binfmt_misc", "nsfs":
			continue
		}
		if kind == "overlay" && path != "/" {
			continue
		}
		seen[path] = true
		var stat syscall.Statfs_t
		var used *float64
		statfs := c.statfs
		if statfs == nil {
			statfs = syscall.Statfs
		}
		if statfs(filepath.Join(c.root, path), &stat) == nil {
			used = diskPercent(stat)
		}
		result = append(result, filesystem{path, used})
		if len(result) == 64 {
			break
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Path < result[j].Path })
	return result
}
