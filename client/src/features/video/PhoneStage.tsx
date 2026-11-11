import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { selectControlling, selectSession } from '@m1k1o/neko'
import { useTranslation } from 'react-i18next'
import {
  IconContext,
  ClipboardTextIcon,
  CopySimpleIcon,
  KeyboardIcon,
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PlayIcon,
  SpeakerHighIcon,
} from '@phosphor-icons/react'
import { useNeko } from '@/state/provider'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/IconButton'
import type { PluginTab } from '@/plugins/types'
import { canReadClipboardText, readClipboardText } from '@/lib/clipboard'
import { PhonePlayer } from './PhonePlayer'
import { ControlBar, Frame, MenuItem, menuItem, tool, toolGroup } from './ControlBar'

// The touch viewer: the stream, and under it the control pill. Keyboard, Copy, Paste and the More
// menu (Back, Forward, Reload, the side panel's tabs) appear next to it only while you have control.
export function PhoneStage({ hideControls, tabs }: { hideControls: boolean; tabs: readonly PluginTab[] }) {
  const { t } = useTranslation()
  const { client, overlay } = useNeko()
  const { hosting, clipboardAllowed, locked, keyboard, connected, video } = useStore(
    client.store,
    useShallow((s) => ({
      hosting: selectControlling(s),
      clipboardAllowed: !!selectSession(s)?.profile.can_access_clipboard,
      locked: s.control.locked,
      keyboard: s.mobile_keyboard_open,
      connected: s.connection.status === 'connected',
      video: s.video,
    })),
  )
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  const [copying, setCopying] = useState(false)
  const copyAbort = useRef<AbortController | null>(null)
  const pasteGeneration = useRef(0)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const syncClipboard = client.syncClipboard
    client.syncClipboard = false
    const invalidate = () => {
      pasteGeneration.current++
      copyAbort.current?.abort()
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
      client.syncClipboard = syncClipboard
      invalidate()
      stop()
    }
  }, [client])

  const paste = async () => {
    if (!client.controlling || client.state.control.locked || reading) return
    if (!canReadClipboardText()) {
      setMessage(t('phone.clipboard_unavailable'))
      return
    }
    const generation = pasteGeneration.current
    setReading(true)
    setMessage('')
    try {
      // Start inside this click's user activation. Safari may ask the user to confirm Paste.
      // Do not focus the input overlay or use the background clipboard-sync path here.
      const text = await readClipboardText()
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

  const copy = async () => {
    if (copying || reading) return
    const abort = new AbortController()
    copyAbort.current = abort
    setCopying(true)
    setMessage('')
    try {
      await client.copySelectionToClipboard(abort.signal)
      if (mounted.current && !abort.signal.aborted) setMessage(t('phone.copied'))
    } catch {
      if (mounted.current) setMessage(t('phone.copy_failed'))
    } finally {
      if (copyAbort.current === abort) copyAbort.current = null
      if (mounted.current) setCopying(false)
    }
  }

  const active = connected && hosting && !locked
  const shortcut = (key: number, modifier?: number) => {
    if (!client.connected || !client.controlling || client.state.control.locked) return
    if (modifier) client.input.key(modifier, true)
    client.input.key(key, true)
    client.input.key(key, false)
    if (modifier) client.input.key(modifier, false)
  }

  return (
    <IconContext.Provider value={{ weight: 'regular' }}>
      <div
        className="relative flex h-full min-h-0 flex-col items-center bg-[#0d0d0d] px-2 pt-[max(8px,env(safe-area-inset-top))] pb-[max(10px,env(safe-area-inset-bottom))]"
        data-testid="phone-stage"
      >
        <Frame hosting={hosting} tight>
          {/* Taps are always remote input: no hidden controls to reveal first. Without control, a
              tap asks for it and lands once it arrives (see PhonePlayer). */}
          <PhonePlayer onTap={() => !hideControls} />
          {video.playable && (!video.playing || (video.muted && video.mutedByAutoplay)) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <button
                type="button"
                className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-black/80 px-4 text-sm text-white shadow-lg"
                onClick={() => {
                  client.unmute()
                  if (!video.playing) void client.play().catch(() => setMessage(t('phone.play_failed')))
                }}
              >
                {video.playing ? <SpeakerHighIcon className="size-5" /> : <PlayIcon className="size-5" />}
                {t(video.playing ? 'phone.unmute' : 'phone.play')}
              </button>
            </div>
          )}
          {message && (
            <p
              role="status"
              className="pointer-events-none absolute inset-x-3 bottom-3 mx-auto w-fit max-w-[calc(100%-24px)] rounded-xl bg-black/85 px-3 py-2 text-center text-sm leading-snug text-white"
            >
              {message}
            </p>
          )}
        </Frame>
        {!hideControls && (
          <div className="shrink-0 pt-2.5" data-testid="phone-controls">
            <ControlBar
              tabs={tabs}
              tools={
                <div className={toolGroup} data-testid="phone-tools">
                  <IconButton
                    label={t('phone.keyboard')}
                    className={cn(tool, keyboard && 'bg-white/20')}
                    disabled={!active}
                    aria-pressed={keyboard}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => overlay.mobileKeyboardToggle()}
                  >
                    <KeyboardIcon className="size-5" />
                  </IconButton>
                  {clipboardAllowed && (
                    <>
                      <IconButton
                        label={t('phone.copy')}
                        className={tool}
                        disabled={!active || copying || reading}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={copy}
                      >
                        <CopySimpleIcon className="size-5" />
                      </IconButton>
                      <IconButton
                        label={t('phone.paste')}
                        className={tool}
                        disabled={!active || reading || copying}
                        onClick={paste}
                      >
                        <ClipboardTextIcon className="size-5" />
                      </IconButton>
                    </>
                  )}
                </div>
              }
              menu={
                <>
                  <MenuItem className={menuItem} disabled={!active} onSelect={() => shortcut(0xff51, 0xffe9)}>
                    <CaretLeftIcon className="size-5" />
                    {t('phone.back')}
                  </MenuItem>
                  <MenuItem className={menuItem} disabled={!active} onSelect={() => shortcut(0xff53, 0xffe9)}>
                    <CaretRightIcon className="size-5" />
                    {t('phone.forward')}
                  </MenuItem>
                  <MenuItem
                    className={menuItem}
                    disabled={!active}
                    data-testid="phone-menu-reload"
                    onSelect={() => shortcut(0xffc2)}
                  >
                    <ArrowClockwiseIcon className="size-5" />
                    {t('phone.reload')}
                  </MenuItem>
                </>
              }
            />
          </div>
        )}
      </div>
    </IconContext.Provider>
  )
}
