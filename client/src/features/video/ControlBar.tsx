import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { selectControlling, selectIsAdmin, selectSession } from '@m1k1o/neko'
import { useTranslation } from 'react-i18next'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowLeftIcon, ArrowsCounterClockwiseIcon, CaretRightIcon, DotsThreeIcon } from '@phosphor-icons/react'
import { useNeko } from '@/state/provider'
import { useActions } from '@/state/actions'
import { name } from '@/state/app'
import { remember } from '@/state/storage'
import { cn } from '@/lib/utils'
import { backLink } from '@/lib/back'
import { IconButton } from '@/components/IconButton'
import { EachHook } from '@/components/EachHook'
import type { PluginTab } from '@/plugins/types'

// The one control under the stream, as in an agent's browser: who has control, and a pill to take
// it over or give it back. While you have control, the tools you need then (Keyboard, Copy, Paste,
// the More menu) sit inside that same light pill, between the status and Return control.

// a tool inside the light pill
export const tool =
  'size-9 shrink-0 rounded-full text-neutral-700 transition-colors hover:bg-black/5 active:bg-black/10 disabled:cursor-default disabled:opacity-35 aria-pressed:bg-black/10 aria-pressed:text-neutral-900'
export const toolGroup = 'flex items-center'
// a More menu entry
export const menuItem =
  'flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] outline-hidden data-disabled:cursor-default data-disabled:opacity-35 data-highlighted:bg-white/10'
const menuContent =
  'z-[1500] max-h-[calc(100vh-80px)] min-w-56 overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900/95 p-1.5 text-white shadow-2xl backdrop-blur-xl'

const always = () => true
const back = backLink()

// How long the pill shows the request as under way before trusting the server's answer.
const pendingMs = 3000

export function useControlState() {
  const { client } = useNeko()
  return useStore(
    client.store,
    useShallow((s) => ({
      connected: s.connection.status === 'connected',
      hosting: selectControlling(s),
      hostId: s.control.host_id,
      locked: s.control.locked,
      allowed: !!selectSession(s)?.profile.can_host && (!s.settings.locked_controls || selectIsAdmin(s)),
      playable: s.video.playable,
    })),
  )
}

export function ControlBar({
  tabs,
  tools,
  menu,
}: {
  tabs: readonly PluginTab[]
  // shown next to the pill while you have control
  tools?: ReactNode
  // the More menu's first entries, while you have control
  menu?: ReactNode
}) {
  const { t } = useTranslation()
  const { client, app } = useNeko()
  const actions = useActions()
  const { connected, hosting, hostId, locked, allowed, playable } = useControlState()
  // the request is on its way: the pill answers the press at once, the server's answer follows
  const [pending, setPending] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const key = `${hosting}|${hostId}`
  useEffect(() => {
    if (pending === null) return
    if (pending !== key) return setPending(null)
    const timer = window.setTimeout(() => setPending(null), pendingMs)
    return () => clearTimeout(timer)
  }, [pending, key])
  useEffect(() => {
    if (!hosting) setOpen(false)
  }, [hosting])

  if (!connected) return null

  const who = hostId ? name(client, hostId) : t('bar.agent')
  const status = hosting ? (locked ? t('bar.paused') : t('bar.you')) : t('bar.has', { name: who })
  const label = hosting ? (locked ? t('bar.resume') : t('bar.return')) : t('bar.take')
  const canPress = hosting || (allowed && playable)
  const press = () => {
    if (hosting && locked) return client.unlock()
    setPending(key)
    actions.toggleControl()
  }

  return (
    <div
      className="pointer-events-none flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 px-3"
      data-testid="control-bar"
      data-hosting={hosting || undefined}
    >
      {back && (
        <a
          href={back}
          aria-label={t('back_link')}
          title={t('back_link')}
          className="pointer-events-auto flex size-9 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10"
          data-testid="bar-back"
        >
          <ArrowLeftIcon className="size-5" />
        </a>
      )}
      <div
        className={cn(
          'pointer-events-auto flex max-w-full items-center rounded-full py-1 pr-1 transition-colors duration-150',
          hosting ? 'bg-neutral-100 pl-1.5 text-neutral-900 min-[480px]:pl-4' : 'pl-4 text-white',
        )}
      >
        <span
          // on a phone the light pill and Return control already say it; the tools need the room
          className={cn('text-[15px] whitespace-nowrap', hosting && 'sr-only min-[480px]:not-sr-only')}
          role="status"
          data-testid="control-status"
        >
          {status}
        </span>
        {hosting && (
          <div className="flex items-center min-[480px]:ml-2" data-testid="control-tools">
            {tools}
            <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
              <Menu.Trigger asChild>
                <IconButton
                  label={t('phone.more')}
                  className={cn(tool, open && 'bg-black/10')}
                  data-testid="phone-more"
                >
                  <DotsThreeIcon className="size-5" weight="bold" />
                </IconButton>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  side="top"
                  align="end"
                  sideOffset={10}
                  collisionPadding={8}
                  className={menuContent}
                  data-testid="phone-menu"
                >
                  {menu}
                  <EachHook items={tabs} use={(tab) => tab.useVisible ?? always}>
                    {(visible) =>
                      tabs
                        .filter((_, i) => visible[i])
                        .map(({ id, icon: Icon, label }) => (
                          <Menu.Item
                            key={id}
                            className={menuItem}
                            data-testid={`phone-menu-${id}`}
                            onSelect={() => {
                              app.setState({ tab: id, sheet: true })
                              remember('tab', id)
                            }}
                          >
                            <Icon className="size-5" />
                            {t(label)}
                          </Menu.Item>
                        ))
                    }
                  </EachHook>
                  <Menu.Item className={menuItem} data-testid="phone-menu-viewer" onSelect={() => location.reload()}>
                    <ArrowsCounterClockwiseIcon className="size-5" />
                    {t('phone.reload_viewer')}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
            {/* where the tools end and the control begins */}
            <span className="mx-1.5 h-5 w-px bg-neutral-300" aria-hidden />
          </div>
        )}
        {canPress && (
          <button
            type="button"
            className={cn(
              'min-h-9 shrink-0 cursor-pointer rounded-full px-4 text-[15px] font-semibold whitespace-nowrap transition-[background-color,transform] duration-100 active:scale-95 disabled:cursor-default',
              hosting
                ? 'bg-neutral-300 text-neutral-900 hover:bg-neutral-400/80'
                : 'ml-3 bg-neutral-100 text-black hover:bg-white',
              pending && 'opacity-60',
            )}
            aria-busy={!!pending || undefined}
            disabled={!!pending}
            onMouseDown={(e) => e.preventDefault()} // the overlay keeps the keyboard focus
            onClick={press}
            data-testid="control-toggle"
          >
            {label}
          </button>
        )}
      </div>
    </div>
  )
}

// a More menu entry that opens a list of its own (the screen sizes)
export function SubMenu({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger className={menuItem}>
        {icon}
        <span className="grow">{label}</span>
        <CaretRightIcon className="size-4 opacity-60" />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent sideOffset={6} collisionPadding={8} className={menuContent}>
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}

export const MenuItem = Menu.Item

// The stream in a rounded frame that hugs the remote screen's shape: watching, a cool tint; in
// control, a light one, joined to the light status pill below.
// `tight`: the touch viewer's thinner frame; `bare`: none at all (fullscreen).
export function Frame({
  children,
  hosting,
  tight = false,
  bare = false,
}: {
  children: ReactNode
  hosting: boolean
  tight?: boolean
  bare?: boolean
}) {
  const { client } = useNeko()
  const { width, height } = useStore(
    client.store,
    useShallow((s) => ({ width: s.screen.size.width || 16, height: s.screen.size.height || 9 })),
  )
  const pad = bare ? 0 : tight ? 4 : 8
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: 'size' }}>
      <div
        className={cn(
          'shrink-0 transition-colors duration-200',
          tight ? 'rounded-[14px]' : 'rounded-[22px]',
          bare
            ? 'rounded-none'
            : hosting
              ? 'bg-neutral-100'
              : 'bg-[linear-gradient(135deg,#cfd6e6_0%,#9aa6c2_45%,#5f6b8a_100%)]',
        )}
        style={{ padding: pad }}
        data-testid="stream-frame"
      >
        <div
          className={cn(
            'relative overflow-hidden bg-black',
            bare ? 'rounded-none' : tight ? 'rounded-[10px]' : 'rounded-[14px]',
          )}
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `min(calc(100cqw - ${2 * pad}px), calc((100cqh - ${2 * pad}px) * ${width / height}))`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
