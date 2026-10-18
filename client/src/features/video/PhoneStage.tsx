import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { selectControlling, selectIsAdmin, selectSession } from '@m1k1o/neko'
import { useTranslation } from 'react-i18next'
import {
  IconContext,
  ClipboardTextIcon,
  CopySimpleIcon,
  KeyboardIcon,
  CursorIcon,
  HandPalmIcon,
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PlayIcon,
  SpeakerHighIcon,
} from '@phosphor-icons/react'
import { useNeko } from '@/state/provider'
import { useActions } from '@/state/actions'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/IconButton'
import { PhonePlayer } from './PhonePlayer'

const control =
  'size-11 shrink-0 rounded-full text-white transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-35 disabled:cursor-default'
const pill = 'pointer-events-auto flex rounded-full border border-white/15 bg-black/80 p-1 shadow-lg backdrop-blur-xl'

export function PhoneStage({ hideControls }: { hideControls: boolean }) {
  const { t } = useTranslation()
  const { client, overlay } = useNeko()
  const actions = useActions()
  const { hosting, allowed, clipboardAllowed, locked, keyboard, connected, video } = useStore(
    client.store,
    useShallow((s) => ({
      hosting: selectControlling(s),
      allowed: !!selectSession(s)?.profile.can_host && (!s.settings.locked_controls || selectIsAdmin(s)),
      clipboardAllowed: !!selectSession(s)?.profile.can_access_clipboard,
      locked: s.control.locked,
      keyboard: s.mobile_keyboard_open,
      connected: s.connection.status === 'connected',
      video: s.video,
    })),
  )
  const stage = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  const [copying, setCopying] = useState(false)
  const copyAbort = useRef<AbortController | null>(null)
  const pasteGeneration = useRef(0)
  const mounted = useRef(false)

  const [activity, setActivity] = useState(0)
  const [hiddenAt, setHiddenAt] = useState('')
  const [pressing, setPressing] = useState(false)
  const pointers = useRef(new Set<number>())
  const idleKey = [activity, connected, hosting, locked, keyboard, reading, copying, video.playing, message].join(':')
  const keepControls = !connected || !video.playing || keyboard || reading || copying || pressing
  const controlsShown = keepControls || hiddenAt !== idleKey
  const noteActivity = () => setActivity((value) => value + 1)

  useEffect(() => {
    if (hideControls || keepControls) return
    const timer = window.setTimeout(() => {
      // Keyboard/assistive-technology users must not lose the control they are using.
      const focused = document.activeElement
      if (focused && stage.current?.contains(focused) && focused.matches(':focus-visible')) return
      setHiddenAt(idleKey)
    }, 3000)
    return () => clearTimeout(timer)
  }, [hideControls, keepControls, idleKey])

  useEffect(() => {
    // A press can end outside the stage. Never hide half-way through a remote drag
    // or multi-touch gesture, and start a fresh idle interval after its last finger.
    const release = (event: PointerEvent) => {
      if (!pointers.current.delete(event.pointerId)) return
      setPressing(pointers.current.size > 0)
      setActivity((value) => value + 1)
    }
    const cancel = () => {
      pointers.current.clear()
      setPressing(false)
      setActivity((value) => value + 1)
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
    }
  }, [])

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
        ref={stage}
        className="relative h-full min-h-0 bg-black"
        data-testid="phone-stage"
        onPointerDownCapture={(event) => {
          if (!controlsShown) return
          pointers.current.add(event.pointerId)
          setPressing(true)
          noteActivity()
        }}
        onPointerMoveCapture={() => {
          if (controlsShown && !pressing) noteActivity()
        }}
        onKeyDownCapture={() => controlsShown && noteActivity()}
        onFocusCapture={() => controlsShown && noteActivity()}
        onBlurCapture={() => controlsShown && noteActivity()}
      >
        <PhonePlayer
          onTap={() => {
            if (!controlsShown) {
              noteActivity()
              return false
            }
            noteActivity()
            if (hideControls) return false
            if (!client.controlling && allowed && client.connected && client.state.video.playable) {
              client.request()
              return false
            }
            return true
          }}
        />
        {!hideControls && controlsShown && (
          <>
            <div className="pointer-events-none absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] flex items-center justify-between gap-3">
              <div className={pill}>
                <IconButton
                  label={t(hosting ? (locked ? 'phone.unlock' : 'phone.release') : 'phone.take')}
                  className={cn(control, hosting && 'bg-white/15')}
                  disabled={!connected || !video.playable || (!hosting && !allowed)}
                  aria-pressed={hosting}
                  onClick={() => {
                    setMessage('')
                    if (hosting && locked) client.unlock()
                    else actions.toggleControl()
                  }}
                >
                  {hosting ? <HandPalmIcon className="size-6" /> : <CursorIcon className="size-6" />}
                </IconButton>
              </div>
              <div className={pill}>
                <IconButton
                  label={t('phone.reload')}
                  className={control}
                  disabled={!active}
                  onClick={() => shortcut(0xffc2)}
                >
                  <ArrowClockwiseIcon className="size-6" />
                </IconButton>
              </div>
            </div>
            <div
              className="pointer-events-none absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] flex items-end justify-between gap-3"
              data-testid="phone-controls"
            >
              <div className={pill}>
                <IconButton
                  label={t('phone.back')}
                  className={control}
                  disabled={!active}
                  onClick={() => shortcut(0xff51, 0xffe9)}
                >
                  <CaretLeftIcon className="size-6" />
                </IconButton>
                <IconButton
                  label={t('phone.forward')}
                  className={control}
                  disabled={!active}
                  onClick={() => shortcut(0xff53, 0xffe9)}
                >
                  <CaretRightIcon className="size-6" />
                </IconButton>
              </div>
              <div className={pill} data-testid="phone-tools">
                <IconButton
                  label={t('phone.keyboard')}
                  className={cn(control, keyboard && 'bg-white/20')}
                  disabled={!active}
                  aria-pressed={keyboard}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => overlay.mobileKeyboardToggle()}
                >
                  <KeyboardIcon className="size-6" />
                </IconButton>
                <IconButton
                  label={t('phone.copy')}
                  className={control}
                  disabled={!active || !clipboardAllowed || copying || reading}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={copy}
                >
                  <CopySimpleIcon className="size-6" />
                </IconButton>
                <IconButton
                  label={t('phone.paste')}
                  className={control}
                  disabled={!active || !clipboardAllowed || reading || copying}
                  onClick={paste}
                >
                  <ClipboardTextIcon className="size-6" />
                </IconButton>
              </div>
            </div>
            {message && (
              <p
                role="status"
                className="pointer-events-none absolute inset-x-3 bottom-19 mx-auto w-fit max-w-[calc(100%-24px)] rounded-xl bg-black/85 px-3 py-2 text-center text-sm leading-snug text-white"
              >
                {message}
              </p>
            )}
          </>
        )}
        {!hideControls && !controlsShown && (
          <button
            type="button"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:rounded-full focus:bg-black focus:p-3 focus:text-white"
            onClick={noteActivity}
          >
            {t('phone.show_controls')}
          </button>
        )}
        {video.playable && (!video.playing || (controlsShown && video.muted && video.mutedByAutoplay)) && (
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
      </div>
    </IconContext.Provider>
  )
}
