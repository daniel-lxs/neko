package desktop

import (
	"fmt"

	"github.com/m1k1o/neko/server/pkg/types"
	"github.com/m1k1o/neko/server/pkg/types/event"
	"github.com/m1k1o/neko/server/pkg/types/message"
	"github.com/m1k1o/neko/server/pkg/xorg"
)

type temporaryScreenSize struct {
	owner    string
	original types.ScreenSize
	applied  types.ScreenSize
}

// Screen writes and temporary ownership share the desktop mutex. A deliberate permanent
// change supersedes a temporary one, even if it selects the same dimensions.
func (manager *DesktopManagerCtx) SetScreenSize(size types.ScreenSize, session types.Session) (types.ScreenSize, error) {
	var notify func()
	mu.Lock()
	defer func() {
		mu.Unlock()
		if notify != nil {
			notify()
		}
	}()
	actual, err := manager.setScreenSizeLocked(size)
	if err == nil {
		manager.temporaryScreen = nil
		notify = manager.screenNotificationLocked(session.ID(), actual)
	}
	return actual, err
}

func (manager *DesktopManagerCtx) SetTemporaryScreenSize(size types.ScreenSize, session types.Session) (types.ScreenSize, error) {
	var notify func()
	mu.Lock()
	defer func() {
		mu.Unlock()
		if notify != nil {
			notify()
		}
	}()
	// Middleware alone is insufficient: a release or disconnect can happen while this
	// request waits for another resize. The lifecycle callback uses this same lock.
	current, exists := manager.sessions.Get(session.ID())
	if !exists || current != session || !session.IsHost() || !session.State().IsConnected || !session.Profile().IsAdmin || !session.Profile().CanHost {
		return types.ScreenSize{}, fmt.Errorf("temporary screen size requires the connected admin host")
	}
	if size.Width < 320 || size.Height < 160 || size.Width > 8192 || size.Height > 8192 || size.Rate < 1 || size.Rate > 60 {
		return types.ScreenSize{}, fmt.Errorf("invalid temporary screen dimensions or rate")
	}
	original := xorg.GetScreenSize()
	if prior := manager.temporaryScreen; prior != nil && original == prior.applied {
		// Keep the original across rotations, keyboard/browser viewport changes, and a
		// new phone taking control before the old host's callback obtains this lock.
		original = prior.original
	}
	actual, err := manager.setScreenSizeLocked(size)
	if err == nil {
		manager.temporaryScreen = &temporaryScreenSize{owner: session.ID(), original: original, applied: actual}
		notify = manager.screenNotificationLocked(session.ID(), actual)
	}
	return actual, err
}

func (manager *DesktopManagerCtx) restoreTemporaryScreenSize() {
	var notify func()
	mu.Lock()
	defer func() {
		mu.Unlock()
		if notify != nil {
			notify()
		}
	}()
	prior := manager.temporaryScreen
	if prior == nil {
		return
	}
	owner, exists := manager.sessions.Get(prior.owner)
	if exists && owner.IsHost() && owner.State().IsConnected && owner.Profile().IsAdmin && owner.Profile().CanHost {
		return
	}
	// Do not undo a screen change made directly by another X11 application.
	if xorg.GetScreenSize() != prior.applied {
		manager.temporaryScreen = nil
		return
	}
	actual, err := manager.setScreenSizeLocked(prior.original)
	if err != nil {
		// Retain the original for a later lifecycle event to retry.
		manager.logger.Error().Err(err).Str("session_id", prior.owner).Str("screen_size", prior.original.String()).Msg("unable to restore temporary screen size")
		return
	}
	manager.temporaryScreen = nil
	notify = manager.screenNotificationLocked(prior.owner, actual)
}

func (manager *DesktopManagerCtx) setScreenSizeLocked(size types.ScreenSize) (types.ScreenSize, error) {
	manager.emmiter.Emit("before_screen_size_change")
	defer manager.emmiter.Emit("after_screen_size_change")
	actual, err := xorg.ChangeScreenSize(size)
	if err == nil {
		manager.screenSize = actual
	}
	return actual, err
}

// Called under mu; the returned notification runs after mu is released. Slow websocket
// readers must not block the actual restore or desktop input. Serialize notifications and
// skip superseded revisions so concurrent resizes cannot announce a stale final size.
func (manager *DesktopManagerCtx) screenNotificationLocked(id string, size types.ScreenSize) func() {
	revision := manager.screenRevision.Add(1)
	return func() {
		manager.screenNotifyMu.Lock()
		defer manager.screenNotifyMu.Unlock()
		if manager.screenRevision.Load() != revision {
			return
		}
		manager.sessions.Broadcast(event.SCREEN_UPDATED, message.ScreenSizeUpdate{ID: id, ScreenSize: size})
	}
}
