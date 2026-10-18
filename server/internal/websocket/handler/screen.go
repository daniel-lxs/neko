package handler

import (
	"errors"

	"github.com/m1k1o/neko/server/pkg/types"
	"github.com/m1k1o/neko/server/pkg/types/message"
)

func (h *MessageHandlerCtx) screenSet(session types.Session, payload *message.ScreenSize) error {
	if !session.Profile().IsAdmin {
		return errors.New("is not the admin")
	}

	_, err := h.desktop.SetScreenSize(payload.ScreenSize, session)
	if err != nil {
		return err
	}

	return nil
}
