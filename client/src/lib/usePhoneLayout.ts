import { useEffect, useState } from 'react'

// Include a phone turned sideways; a short desktop window still uses the desktop layout.
const query = '(max-width: 768px) and (pointer: coarse), (max-height: 500px) and (pointer: coarse)'

export function usePhoneLayout() {
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches)
  const [viewport, setViewport] = useState({ height: window.innerHeight, top: 0 })
  useEffect(() => {
    const media = window.matchMedia(query)
    const changed = () => setPhone(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (!phone) return
    // The visual viewport excludes Safari's chrome and on-screen keyboard. Keep the controls
    // visible there without changing the desktop layout or disabling browser zoom.
    const visual = window.visualViewport
    const resize = () => {
      if (visual && visual.scale !== 1) return // pinch zoom is local, not a remote resolution change
      setViewport({ height: visual?.height ?? window.innerHeight, top: visual?.offsetTop ?? 0 })
    }
    resize()
    visual?.addEventListener('resize', resize)
    visual?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    return () => {
      visual?.removeEventListener('resize', resize)
      visual?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
    }
  }, [phone])
  return { phone, viewport }
}
