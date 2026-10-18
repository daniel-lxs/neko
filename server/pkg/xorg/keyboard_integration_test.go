package xorg

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Run against an isolated X server, never a user's desktop:
// NEKO_XORG_TEST_DISPLAY=:99 go test ./pkg/xorg -run TestKeyboardText -v
func TestKeyboardText(t *testing.T) {
	display := os.Getenv("NEKO_XORG_TEST_DISPLAY")
	if display == "" {
		t.Skip("requires an isolated X server and a C compiler")
	}
	binary := filepath.Join(t.TempDir(), "keyboard")
	compile := exec.Command("cc", "testdata/keyboard.c", "-o", binary,
		"-lX11", "-lXrandr", "-lXtst", "-lXfixes", "-lXi", "-lxcvt")
	if output, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("compile keyboard receiver: %v\n%s", err, output)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	run := exec.CommandContext(ctx, binary)
	run.Env = append(os.Environ(), "DISPLAY="+display)
	output, err := run.CombinedOutput()
	t.Logf("X11 keyboard round trip:\n%s", output)
	if err != nil {
		t.Fatalf("keyboard round trip: %v", err)
	}
}
