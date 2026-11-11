import { useRef } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { selectControlling, selectIsAdmin } from '@m1k1o/neko'
import { useTranslation } from 'react-i18next'
import {
  ArrowsOutIcon,
  ClipboardIcon,
  MonitorIcon,
  PictureInPictureIcon,
  PlayCircleIcon,
  SpeakerHighIcon,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { PluginTab } from '@/plugins/types'
import { useNeko } from '@/state/provider'
import { IconButton } from '@/components/IconButton'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { Emote } from '@/features/emotes/Emote'
import { Clipboard } from './Clipboard'
import { Player } from './Player'
import { PhoneStage } from './PhoneStage'
import { ControlBar, Frame, MenuItem, SubMenu, menuItem, tool, toolGroup } from './ControlBar'
import { useFullscreen } from './useFullscreen'
import { useClipboardSync, canReadClipboard } from './useClipboardSync'
import { usePip } from './usePip'

// the play / unmute button covering the video
const overlayClasses =
  'absolute inset-0 flex cursor-pointer items-center justify-center overflow-hidden rounded-none bg-black/20'

// The viewer: the stream and the control pill under it (ControlBar). `tabs`: the side panel's,
// opened from the More menu.
export function Stage({
  phone = false,
  ...props
}: {
  phone?: boolean
  hideControls: boolean
  tabs: readonly PluginTab[]
}) {
  return phone ? <PhoneStage {...props} /> : <DesktopStage {...props} />
}

function DesktopStage({ hideControls, tabs }: { hideControls: boolean; tabs: readonly PluginTab[] }) {
  const { t } = useTranslation()
  const { client, app } = useNeko()
  const { admin, hosting, video, configurations, size } = useStore(
    client.store,
    useShallow((s) => ({
      admin: selectIsAdmin(s),
      hosting: selectControlling(s),
      video: s.video,
      configurations: s.screen.configurations,
      size: s.screen.size,
    })),
  )
  const emotes = useStore(app, (s) => s.emotes)
  const player = useRef<HTMLDivElement>(null)
  const { fullscreen, request: requestFullscreen } = useFullscreen(player)
  const syncClipboard = useClipboardSync()
  const pip = usePip()
  const { playing, playable, muted, mutedByAutoplay } = video

  return (
    <div className={cn('flex h-full w-full flex-col items-center bg-[#0d0d0d]', fullscreen ? 'p-0' : 'px-6 pt-6 pb-5')}>
      {/* fullscreen: the stream alone, edge to edge */}
      <div ref={player} className={cn('relative flex min-h-0 w-full flex-1', fullscreen && 'bg-black')}>
        <Frame hosting={hosting} bare={fullscreen}>
          <div className="absolute inset-0" data-testid="player" onMouseEnter={syncClipboard}>
            <Player transport={client.transport} />
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {Object.entries(emotes).map(([id, type]) => (
                <Emote key={id} id={id} type={type} />
              ))}
            </div>
            {!playing && playable ? (
              <IconButton
                label="Play"
                className={overlayClasses}
                data-testid="player-overlay"
                onClick={() => (client.unmute(), client.play().catch(() => {}))}
              >
                <PlayCircleIcon className="size-[120px]" />
              </IconButton>
            ) : (
              // only for the mute that autoplay forced; a user who muted on purpose keeps the desktop
              playing &&
              muted &&
              mutedByAutoplay && (
                <IconButton
                  label="Unmute"
                  className={overlayClasses}
                  data-testid="player-overlay"
                  onClick={() => client.unmute()}
                >
                  <SpeakerHighIcon className="size-[120px]" />
                </IconButton>
              )
            )}
          </div>
        </Frame>
      </div>
      {!hideControls && !fullscreen && (
        <div className="shrink-0 pt-4">
          <ControlBar
            tabs={tabs}
            tools={
              !canReadClipboard && (
                <div className={toolGroup}>
                  {/* modal: the overlay takes the keyboard focus when the mouse enters the video,
                      which would close the popover and send its Ctrl+C to the remote */}
                  <Popover modal>
                    <PopoverTrigger asChild>
                      <IconButton label="Clipboard" className={tool} data-testid="clipboard-open">
                        <ClipboardIcon className="size-5" />
                      </IconButton>
                    </PopoverTrigger>
                    <Clipboard />
                  </Popover>
                </div>
              )
            }
            menu={
              <>
                <MenuItem className={menuItem} onSelect={requestFullscreen}>
                  <ArrowsOutIcon className="size-5" />
                  {t('bar.fullscreen')}
                </MenuItem>
                {pip.canPip && (
                  <MenuItem className={menuItem} onSelect={pip.request}>
                    <PictureInPictureIcon className="size-5" />
                    {t('bar.pip')}
                  </MenuItem>
                )}
                {admin && configurations.length > 0 && (
                  <SubMenu icon={<MonitorIcon className="size-5" />} label={t('bar.resolution')}>
                    {configurations.map((c, i) => {
                      const active = c.width === size.width && c.height === size.height && c.rate === size.rate
                      return (
                        <MenuItem
                          key={i}
                          className={cn(menuItem, 'min-h-8', active && 'bg-white/10')}
                          data-testid="resolution-item"
                          data-active={active || undefined}
                          onSelect={() => client.setScreenSize(c.width, c.height, c.rate)}
                        >
                          <span className="grow">
                            {c.width}x{c.height}
                          </span>
                          <small className="text-xs opacity-60">{c.rate}</small>
                        </MenuItem>
                      )
                    })}
                  </SubMenu>
                )}
              </>
            }
          />
        </div>
      )}
    </div>
  )
}
