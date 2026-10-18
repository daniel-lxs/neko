import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { selectControlling, selectIsAdmin, selectSession } from '@m1k1o/neko'
import { useTranslation } from 'react-i18next'
import { ClipboardIcon, KeyboardIcon, MouseIcon, PlayIcon, SpeakerHighIcon } from '@phosphor-icons/react'
import { useNeko } from '@/state/provider'
import { useActions } from '@/state/actions'
import { cn } from '@/lib/utils'
import { Player } from './Player'

const control =
  'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-base leading-tight font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40'

export function PhoneStage({ hideControls }: { hideControls: boolean }) {
  const { t } = useTranslation()
  const { client, overlay } = useNeko()
  const actions = useActions()
  const { hosting, admin, allowed, clipboardAllowed, locked, keyboard, connected, video } = useStore(
    client.store,
    useShallow((s) => ({
      hosting: selectControlling(s),
      admin: selectIsAdmin(s),
      allowed: !!selectSession(s)?.profile.can_host && (!s.settings.locked_controls || selectIsAdmin(s)),
      clipboardAllowed: !!selectSession(s)?.profile.can_access_clipboard,
      locked: s.control.locked,
      keyboard: s.mobile_keyboard_open,
      connected: s.connection.status === 'connected',
      video: s.video,
    })),
  )
  const area = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  const pasteGeneration = useRef(0)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const invalidate = () => {
      pasteGeneration.current++
    }
    // Even losing and regaining the same control/session cancels a pending permission prompt.
    const stop = client.store.subscribe(
      (s) =>
        [
          s.session_id,
          s.control.host_id,
          s.connection.status,
          s.control.locked,
          selectSession(s)?.profile.can_access_clipboard,
          selectSession(s)?.profile.can_host,
        ].join('|'),
      invalidate,
    )
    return () => {
      mounted.current = false
      invalidate()
      stop()
    }
  }, [client])

  useEffect(() => {
    const box = area.current!
    const observer = new ResizeObserver(() => {
      // Fit the remote to the full layout viewport, not the visual viewport's keyboard
      // animation. Only the local player/controls should shrink while the keyboard is open.
      const controlsHeight = box.parentElement!.clientHeight - box.clientHeight
      setSize({ width: box.clientWidth, height: window.innerHeight - controlsHeight })
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Resolution belongs to the shared desktop. Only its current admin controller follows
    // this viewport; spectators and an open software keyboard must never resize the room.
    if (hideControls || !hosting || !admin || !connected || keyboard || size.width < 320 || size.height < 160) return
    // Xorg rounds widths to eight pixels; use even heights for the video encoder.
    // Chromium's desktop window needs at least 500px. Keep the phone aspect ratio
    // at a 512px minimum rather than shrinking the desktop below the application's limit.
    const width = Math.max(512, Math.floor(size.width / 8) * 8)
    const height = Math.floor((size.height * width) / size.width / 2) * 2
    let active = true
    const timer = window.setTimeout(() => {
      if (
        !client.controlling ||
        !client.isAdmin ||
        client.state.mobile_keyboard_open ||
        (window.visualViewport && window.visualViewport.scale !== 1)
      )
        return
      const current = client.state.screen.size
      if (current.width === width && current.height === height) return
      // The server owns this temporary size and restores it when control or the session ends.
      void client.api
        .req('POST', '/room/screen/temporary', { width, height, rate: current.rate })
        .catch(() => active && setMessage(t('phone.resize_failed')))
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [client, hideControls, hosting, admin, connected, keyboard, size, t])

  const paste = async () => {
    if (!client.controlling || client.state.control.locked || reading) return
    if (!window.isSecureContext || typeof navigator.clipboard?.readText !== 'function') {
      setMessage(t('phone.clipboard_unavailable'))
      return
    }
    const generation = pasteGeneration.current
    setReading(true)
    setMessage('')
    try {
      // Start inside this click's user activation. Safari may ask the user to confirm Paste.
      // Do not focus the input overlay or use the background clipboard-sync path here.
      const text = await navigator.clipboard.readText()
      if (!mounted.current) return
      if (
        !client.connected ||
        !client.controlling ||
        client.state.control.locked ||
        pasteGeneration.current !== generation ||
        !client.session?.profile.can_access_clipboard
      ) {
        setMessage(t('phone.control_lost'))
      } else if (!text) {
        setMessage(t('phone.clipboard_empty'))
      } else {
        client.paste(text)
      }
    } catch {
      if (mounted.current) setMessage(t('phone.clipboard_denied'))
    } finally {
      if (mounted.current) setReading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-tertiary" data-testid="phone-stage">
      <div ref={area} className="relative min-h-0 flex-1 overflow-hidden bg-black" data-testid="phone-screen">
        <Player transport={client.transport} />
        {video.playable && (!video.playing || (video.muted && video.mutedByAutoplay)) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              className={cn(control, 'pointer-events-auto flex-row gap-2 bg-style-primary px-5 text-black shadow-lg')}
              onClick={() => {
                client.unmute()
                if (!video.playing) void client.play().catch(() => setMessage(t('phone.play_failed')))
              }}
            >
              {video.playing ? <SpeakerHighIcon className="size-6" /> : <PlayIcon className="size-6" />}
              {t(video.playing ? 'phone.unmute' : 'phone.play')}
            </button>
          </div>
        )}
      </div>
      {!hideControls && (
        <div
          className="shrink-0 border-t border-white/10 p-2 pb-[max(8px,env(safe-area-inset-bottom))]"
          data-testid="phone-controls"
        >
          {message && (
            <p role="status" className="mb-2 text-center text-sm leading-snug text-white">
              {message}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={cn(control, 'bg-background-accent text-white')}
              disabled={!connected || !video.playable || (!hosting && !allowed)}
              onClick={() => {
                setMessage('')
                if (hosting && locked) client.unlock()
                else actions.toggleControl()
              }}
            >
              <MouseIcon className="size-6" />
              {t(hosting ? (locked ? 'phone.unlock' : 'phone.release') : 'phone.take')}
            </button>
            {clipboardAllowed && (
              <button
                type="button"
                className={cn(control, 'bg-style-primary text-black')}
                disabled={!connected || !hosting || locked || reading}
                onClick={paste}
              >
                <ClipboardIcon className="size-6" />
                {t('phone.paste')}
              </button>
            )}
            <button
              type="button"
              className={cn(control, keyboard ? 'bg-white text-black' : 'bg-background-accent text-white')}
              disabled={!connected || !hosting || locked}
              aria-pressed={keyboard}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => overlay.mobileKeyboardToggle()}
            >
              <KeyboardIcon className="size-6" />
              {t('phone.keyboard')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
