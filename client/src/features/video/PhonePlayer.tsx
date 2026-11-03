import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNeko } from '@/state/provider'
import { Player } from './Player'

type Point = { x: number; y: number }
type View = Point & { scale: number }
const fitted: View = { x: 0, y: 0, scale: 1 }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
// A finger held this long without moving presses the remote mouse button; moving then drags.
const holdMs = 450

// Zoom the stream image locally. The overlay beneath the gesture surface still owns
// keyboard input, but never receives the first finger of a possible pinch or pan.
// Press and hold, then move, drags on the remote desktop (sliders, selections, maps).
export function PhonePlayer({ onTap }: { onTap: () => boolean }) {
  const { client } = useNeko()
  const frame = useRef<HTMLDivElement>(null)
  const gestures = useRef<HTMLDivElement>(null)
  const points = useRef(new Map<number, Point>())
  const tap = useRef<{
    id: number
    start: Point
    at: number
    moved: boolean
    fitted: boolean
    accept: () => boolean
  } | null>(null)
  // the remote drag in progress: the finger holding the button down
  const drag = useRef<{ id: number } | null>(null)
  const holdTimer = useRef(0)
  const [dragAt, setDragAt] = useState<Point | null>(null)
  const current = useRef<View>(fitted)
  const [view, setView] = useState<View>(fitted)
  const [ripple, setRipple] = useState<(Point & { id: number }) | null>(null)
  const rippleTimer = useRef(0)
  const rippleId = useRef(0)

  const constrain = (next: View): View => {
    const box = frame.current!.getBoundingClientRect()
    const screen = client.state.screen.size
    const fit = Math.min(box.width / screen.width, box.height / screen.height)
    const scale = Math.max(1, Math.min(6, next.scale))
    const limitX = Math.max(0, (screen.width * fit * scale - box.width) / 2)
    const limitY = Math.max(0, (screen.height * fit * scale - box.height) / 2)
    return { scale, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) }
  }
  const commit = (next: View) => {
    current.current = constrain(next)
    setView(current.current)
  }

  useEffect(() => {
    // iOS dismisses the keyboard after a touch outside the focused textarea,
    // even when pointerdown was cancelled. Cancel that touch default as well;
    // our pointer handlers still own the remote tap, pinch and pan. React's
    // delegated touch listeners are passive, so this must be a native listener.
    const surface = gestures.current!
    const keepKeyboard = (event: TouchEvent) => {
      if (client.state.mobile_keyboard_open) event.preventDefault()
    }
    surface.addEventListener('touchstart', keepKeyboard, { passive: false })
    const cancel = () => {
      points.current.clear()
      tap.current = null
      endDrag()
    }
    const observer = new ResizeObserver(() => {
      // Viewport/keyboard changes only clamp the local image. Never resize the server.
      const box = frame.current!.getBoundingClientRect()
      const screen = client.state.screen.size
      const fit = Math.min(box.width / screen.width, box.height / screen.height)
      const v = current.current
      const x = Math.max(0, (screen.width * fit * v.scale - box.width) / 2)
      const y = Math.max(0, (screen.height * fit * v.scale - box.height) / 2)
      current.current = { scale: v.scale, x: Math.max(-x, Math.min(x, v.x)), y: Math.max(-y, Math.min(y, v.y)) }
      setView(current.current)
      cancel()
    })
    observer.observe(frame.current!)
    const unwatch = client.store.subscribe(
      (s) =>
        [
          s.session_id,
          s.control.host_id,
          s.control.locked,
          s.connection.status,
          s.screen.size.width,
          s.screen.size.height,
          s.sessions[s.session_id ?? '']?.profile.can_host,
          s.sessions[s.session_id ?? '']?.profile.is_admin,
          s.settings.private_mode,
        ].join('|'),
      cancel,
    )
    // A manually changed desktop size starts fitted; ordinary control changes retain zoom.
    const unsize = client.store.subscribe(
      (s) => `${s.screen.size.width}x${s.screen.size.height}`,
      () => {
        current.current = fitted
        setView(fitted)
      },
    )
    window.addEventListener('blur', cancel)
    return () => {
      surface.removeEventListener('touchstart', keepKeyboard)
      observer.disconnect()
      unwatch()
      unsize()
      window.removeEventListener('blur', cancel)
      clearTimeout(rippleTimer.current)
      endDrag()
    }
    // endDrag only reads refs and the client
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const point = (event: ReactPointerEvent): Point => ({ x: event.clientX, y: event.clientY })
  const canSend = () =>
    client.connected &&
    !client.privateModeEnabled &&
    client.controlling &&
    !client.state.control.locked &&
    !!client.session?.profile.can_host
  // A viewport point on the remote desktop, through the decoded image's letterboxing. Outside the
  // image: null, or with clamp the nearest edge pixel (a drag may leave the image).
  const remote = (position: Point, clamp = false): Point | null => {
    const element = client.transport.element
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const screen = client.state.screen.size
    // Account for the actual decoded image's contain-letterboxing, including a
    // codec's padded dimensions. clientX/Y and this rect use the same coordinates.
    const width = element instanceof HTMLVideoElement ? element.videoWidth : screen.width
    const height = element instanceof HTMLVideoElement ? element.videoHeight : screen.height
    if (!width || !height || !rect.width || !rect.height) return null
    const fit = Math.min(rect.width / width, rect.height / height)
    const left = rect.left + (rect.width - width * fit) / 2
    const top = rect.top + (rect.height - height * fit) / 2
    let x = (position.x - left) / (width * fit)
    let y = (position.y - top) / (height * fit)
    if (clamp) {
      x = Math.max(0, Math.min(x, 0.9999))
      y = Math.max(0, Math.min(y, 0.9999))
    } else if (x < 0 || x >= 1 || y < 0 || y >= 1) return null
    return {
      x: Math.min(screen.width - 1, Math.round(x * screen.width)),
      y: Math.min(screen.height - 1, Math.round(y * screen.height)),
    }
  }
  const local = (p: Point): Point => {
    const box = frame.current!.getBoundingClientRect()
    return { x: p.x - box.left, y: p.y - box.top }
  }
  // Lifts the remote button of a drag in progress; any end of the gesture must come here.
  function endDrag(at?: Point) {
    clearTimeout(holdTimer.current)
    if (!drag.current) return
    drag.current = null
    setDragAt(null)
    if (!canSend()) return
    const p = at && remote(at, true)
    if (p) client.input.move(p.x, p.y)
    client.input.button(1, false)
  }
  const hold = (id: number) => {
    const candidate = tap.current
    if (!candidate || candidate.id !== id || candidate.moved || points.current.size !== 1) return
    // Same rules as a tap: a hold while the controls are hidden only reveals them, and one
    // without control asks for it.
    tap.current = null
    if (!candidate.accept() || !canSend()) return
    const p = remote(candidate.start)
    if (!p) return
    drag.current = { id }
    client.input.move(p.x, p.y)
    client.input.button(1, true)
    setDragAt(local(candidate.start))
    navigator.vibrate?.(10)
  }
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (drag.current) return // one finger drags; others wait for it to lift
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event)
    points.current.set(event.pointerId, p)
    tap.current =
      points.current.size === 1
        ? {
            id: event.pointerId,
            start: p,
            at: performance.now(),
            moved: false,
            fitted: current.current.scale === 1,
            accept: onTap,
          }
        : null
    clearTimeout(holdTimer.current)
    if (tap.current) {
      const id = event.pointerId
      holdTimer.current = window.setTimeout(() => hold(id), holdMs)
    }
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = points.current.get(event.pointerId)
    if (!previous) return
    event.preventDefault()
    event.stopPropagation()
    if (drag.current) {
      if (drag.current.id !== event.pointerId) return
      points.current.set(event.pointerId, point(event))
      if (!canSend()) return endDrag()
      const p = remote(point(event), true)
      if (p) client.input.move(p.x, p.y)
      setDragAt(local(point(event)))
      return
    }
    const before = [...points.current.values()]
    const p = point(event)
    points.current.set(event.pointerId, p)
    if (tap.current && distance(tap.current.start, p) > 8) {
      tap.current.moved = true
      clearTimeout(holdTimer.current)
    }
    const v = current.current
    if (points.current.size >= 2) {
      tap.current = null
      clearTimeout(holdTimer.current)
      const after = [...points.current.values()]
      const oldCenter = midpoint(before[0], before[1])
      const newCenter = midpoint(after[0], after[1])
      const oldDistance = distance(before[0], before[1])
      if (oldDistance < 1) return
      const scale = Math.max(1, Math.min(6, (v.scale * distance(after[0], after[1])) / oldDistance))
      const box = frame.current!.getBoundingClientRect()
      const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      commit({
        scale,
        x: newCenter.x - center.x - ((oldCenter.x - center.x - v.x) * scale) / v.scale,
        y: newCenter.y - center.y - ((oldCenter.y - center.y - v.y) * scale) / v.scale,
      })
    } else if (!tap.current || tap.current.moved) {
      commit({ ...v, x: v.x + p.x - previous.x, y: v.y + p.y - previous.y })
    }
  }
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId)) return
    event.preventDefault()
    event.stopPropagation()
    points.current.delete(event.pointerId)
    clearTimeout(holdTimer.current)
    if (drag.current?.id === event.pointerId) return endDrag(point(event))
    const candidate = tap.current
    tap.current = null
    if (!candidate || candidate.id !== event.pointerId || points.current.size) return
    const moved = candidate.moved || distance(candidate.start, point(event)) > 8
    const scrolling = moved && candidate.fitted && current.current.scale === 1
    if (moved && !scrolling) return
    if (!moved && performance.now() - candidate.at > 600) return
    // A hidden-state tap only reveals controls; deliberate swipes can scroll while
    // hidden. No remote input is sent before the entire single-finger gesture ends.
    if ((!scrolling && !candidate.accept()) || !canSend()) return
    const target = remote(scrolling ? candidate.start : point(event))
    if (!target) return
    client.input.move(target.x, target.y)
    if (scrolling) {
      const steps = (delta: number) =>
        Math.abs(delta) <= 8 ? 0 : Math.sign(delta) * Math.min(12, Math.max(1, Math.round(Math.abs(delta) / 53)))
      client.input.scroll(steps(event.clientX - candidate.start.x), steps(event.clientY - candidate.start.y), false)
      return
    }
    client.input.button(1, true)
    client.input.button(1, false)
    const box = frame.current!.getBoundingClientRect()
    setRipple({ id: ++rippleId.current, x: event.clientX - box.left, y: event.clientY - box.top })
    clearTimeout(rippleTimer.current)
    rippleTimer.current = window.setTimeout(() => setRipple(null), 500)
  }

  return (
    <div ref={frame} className="absolute inset-0 overflow-hidden" data-testid="phone-image" data-scale={view.scale}>
      <div
        className="absolute inset-0 origin-center"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <Player transport={client.transport} />
      </div>
      <div
        ref={gestures}
        className="phone-gestures absolute inset-0 touch-none select-none"
        data-testid="phone-gesture-surface"
        data-dragging={dragAt ? '' : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(event) => {
          points.current.delete(event.pointerId)
          tap.current = null
          if (!drag.current || drag.current.id === event.pointerId) endDrag()
        }}
        onLostPointerCapture={(event) => {
          points.current.delete(event.pointerId)
          tap.current = null
          if (!drag.current || drag.current.id === event.pointerId) endDrag()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      {dragAt && (
        <span
          className="pointer-events-none absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-400/50 shadow-[0_0_0_2px_#0284c7]"
          style={{ left: dragAt.x, top: dragAt.y }}
          data-testid="phone-drag"
        />
      )}
      {ripple && (
        <span
          key={ripple.id}
          className="phone-tap-ripple pointer-events-none absolute size-10 rounded-full border-2 border-white bg-sky-400/40 shadow-[0_0_0_2px_#0284c7]"
          style={{ left: ripple.x, top: ripple.y }}
          data-testid="phone-tap-ripple"
        />
      )}
    </div>
  )
}
