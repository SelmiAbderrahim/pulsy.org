package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func equal(t *testing.T, actual *float64, want float64) {
	t.Helper()
	if actual == nil || *actual != want {
		t.Fatalf("metric %v, want %v", actual, want)
	}
}
func TestCPUUsesDeltasWithoutCountingGuestsTwice(t *testing.T) {
	a := parseCPU("cpu 100 0 20 80 0 0 0 0 50 0\ncpu0 1 2")
	b := parseCPU("cpu 150 0 30 120 0 0 0 0 75 0")
	if a == nil || a.total != 200 {
		t.Fatal(a)
	}
	equal(t, cpuPercent(a, b), 60)
	for _, pair := range [][2]*cpuCounters{{nil, b}, {a, nil}, {b, a}, {a, a}, {{100, 50}, {110, 40}}, {{100, 0}, {110, 20}}} {
		if cpuPercent(pair[0], pair[1]) != nil {
			t.Fatal("initial/reset/invalid counters must be unavailable")
		}
	}
	if parseCPU("cpu broken") != nil {
		t.Fatal("malformed counter accepted")
	}
}
func TestMemoryUsesAvailableAndSwapAbsenceIsNull(t *testing.T) {
	memory, swap := memoryPercent("MemTotal: 1000 kB\nMemFree: 50 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 100 kB\n")
	equal(t, memory, 60)
	equal(t, swap, 50)
	memory, swap = memoryPercent("MemTotal: 1000 kB\nMemFree: 50 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n")
	if memory != nil || swap != nil {
		t.Fatal("missing available memory or swap fabricated")
	}
	memory, _ = memoryPercent("MemTotal: 100 kB\nMemAvailable: 200 kB\n")
	if memory != nil {
		t.Fatal("invalid memory accepted")
	}
}
func fixtureFile(t *testing.T, root, path, value string) {
	t.Helper()
	target := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(value), 0644); err != nil {
		t.Fatal(err)
	}
}
func TestHostMountsMissingFilesRebootAndUnavailableDisks(t *testing.T) {
	proc, root := t.TempDir(), t.TempDir()
	fixtureFile(t, proc, "sys/kernel/random/boot_id", "a811372b-61f5-444a-9cbe-9a1c651a8e49\n")
	fixtureFile(t, proc, "stat", "cpu 100 0 20 80 0 0 0 0\n")
	fixtureFile(t, proc, "meminfo", "MemTotal: 1000 kB\nMemAvailable: 400 kB\n")
	fixtureFile(t, proc, "uptime", "120.5 100\n")
	fixtureFile(t, proc, "loadavg", "1.1 2.2 3.3 1/2 123\n")
	fixtureFile(t, proc, "1/mountinfo", "1 0 8:1 / / rw - ext4 /dev/sda rw\n2 0 8:2 / /data rw - xfs /dev/sdb rw\n3 0 8:3 / /skip rw - ext4 /dev/sdc rw\n4 0 0:1 / /proc rw - proc proc rw\n")
	seen := []string{}
	c := collector{proc: proc, root: root, excludes: []string{"/skip"}, statfs: func(path string, stat *syscall.Statfs_t) error {
		seen = append(seen, path)
		if path == filepath.Join(root, "data") {
			return os.ErrPermission
		}
		stat.Blocks = 100
		stat.Bfree = 40
		stat.Bavail = 30
		return nil
	}}
	first, err := c.collect(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if first.CPU != nil || first.Swap != nil {
		t.Fatal("unavailable metric fabricated")
	}
	equal(t, first.Memory, 60)
	equal(t, first.Uptime, 120.5)
	if len(first.Filesystems) != 2 || first.Filesystems[1].Used != nil || seen[0] != root || seen[1] != filepath.Join(root, "data") {
		t.Fatalf("host roots not used: %v %v", seen, first.Filesystems)
	}
	fixtureFile(t, proc, "stat", "cpu 150 0 30 120 0 0 0 0\n")
	second, err := c.collect(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, second.CPU, 60)
	fixtureFile(t, proc, "sys/kernel/random/boot_id", "b811372b-61f5-444a-9cbe-9a1c651a8e49\n")
	third, _ := c.collect(time.Now())
	if third.CPU != nil {
		t.Fatal("reboot retained CPU baseline")
	}
	if err := os.Remove(filepath.Join(proc, "meminfo")); err != nil {
		t.Fatal(err)
	}
	missing, _ := c.collect(time.Now())
	if missing.Memory != nil {
		t.Fatal("missing file fabricated")
	}
	if err := os.Remove(filepath.Join(proc, "sys/kernel/random/boot_id")); err != nil {
		t.Fatal(err)
	}
	if _, err := c.collect(time.Now()); err == nil {
		t.Fatal("missing host identity accepted")
	}
}
func TestDiskReservedSpaceAndInvalidNumbers(t *testing.T) {
	equal(t, diskPercent(syscall.Statfs_t{Blocks: 100, Bfree: 50, Bavail: 50}), 50)
	if diskPercent(syscall.Statfs_t{}) != nil || number("NaN") != nil || number("+Inf") != nil || number("-1") != nil {
		t.Fatal("invalid metric accepted")
	}
}
