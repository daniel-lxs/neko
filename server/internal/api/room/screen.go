package room

import (
	"net/http"
	"strconv"

	"github.com/m1k1o/neko/server/pkg/auth"
	"github.com/m1k1o/neko/server/pkg/types"
	"github.com/m1k1o/neko/server/pkg/utils"
)

func (h *RoomHandler) screenConfiguration(w http.ResponseWriter, r *http.Request) error {
	screenSize := h.desktop.GetScreenSize()

	return utils.HttpSuccess(w, screenSize)
}

func (h *RoomHandler) screenConfigurationChange(w http.ResponseWriter, r *http.Request) error {
	auth, _ := auth.GetSession(r)

	data := &types.ScreenSize{}
	if err := utils.HttpJsonRequest(w, r, data); err != nil {
		return err
	}

	size, err := h.desktop.SetScreenSize(types.ScreenSize{
		Width:  data.Width,
		Height: data.Height,
		Rate:   data.Rate,
	}, auth)

	if err != nil {
		return utils.HttpUnprocessableEntity("cannot set screen size").WithInternalErr(err)
	}

	return utils.HttpSuccess(w, size)
}

// Temporary dimensions belong to the connected admin controller, not to the HTTP request.
// The desktop manager rechecks ownership under its resize lock and restores the saved size
// on control loss or session end, even if the browser cannot send an unload request.
func (h *RoomHandler) screenTemporaryChange(w http.ResponseWriter, r *http.Request) error {
	session, _ := auth.GetSession(r)
	data := &types.ScreenSize{}
	if err := utils.HttpJsonRequest(w, r, data); err != nil {
		return err
	}
	size, err := h.desktop.SetTemporaryScreenSize(*data, session)
	if err != nil {
		return utils.HttpUnprocessableEntity("cannot set temporary screen size").WithInternalErr(err)
	}
	return utils.HttpSuccess(w, size)
}

// TODO: remove.
func (h *RoomHandler) screenConfigurationsList(w http.ResponseWriter, r *http.Request) error {
	configurations := h.desktop.ScreenConfigurations()

	return utils.HttpSuccess(w, configurations)
}

func (h *RoomHandler) screenShotGet(w http.ResponseWriter, r *http.Request) error {
	quality, err := strconv.Atoi(r.URL.Query().Get("quality"))
	if err != nil {
		quality = 90
	}

	img := h.desktop.GetScreenshotImage()
	bytes, err := utils.CreateJPGImage(img, quality)
	if err != nil {
		return utils.HttpInternalServerError().WithInternalErr(err)
	}

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Content-Type", "image/jpeg")

	_, err = w.Write(bytes)
	return err
}

func (h *RoomHandler) screenCastGet(w http.ResponseWriter, r *http.Request) error {
	// display fallback image when private mode is enabled even if screencast is not
	if session, ok := auth.GetSession(r); ok && session.PrivateModeEnabled() {
		if h.privateModeImage != nil {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Header().Set("Content-Type", "image/jpeg")

			_, err := w.Write(h.privateModeImage)
			return err
		}

		return utils.HttpBadRequest("private mode is enabled but no fallback image available")
	}

	screencast := h.capture.Screencast()
	if !screencast.Enabled() {
		return utils.HttpBadRequest("screencast pipeline is not enabled")
	}

	bytes, err := screencast.Image()
	if err != nil {
		return utils.HttpInternalServerError().WithInternalErr(err)
	}

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Content-Type", "image/jpeg")

	_, err = w.Write(bytes)
	return err
}
