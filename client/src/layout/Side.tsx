import { useEffect } from 'react'
import { useStore } from 'zustand'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontalIcon, XIcon } from '@phosphor-icons/react'
import { useApp } from '@/state/provider'
import { remember } from '@/state/storage'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Settings } from '@/features/settings/Settings'
import { useSlot } from '@/plugins'
import type { PluginTab } from '@/plugins/types'
import { EachHook } from '@/components/EachHook'
import { IconButton } from '@/components/IconButton'
import { Dialog, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from '@/components/ui/dialog'

// after the plugins' tabs
const settingsTab: PluginTab = {
  id: 'settings',
  icon: SlidersHorizontalIcon,
  label: 'side.settings',
  component: Settings,
}
const always = () => true

// `sheet`: the touch viewer's full-screen panel, which fills its dialog and has nothing to scroll to
export function Side({ sheet = false }: { sheet?: boolean }) {
  const tabs = [...useSlot('side.tab'), settingsTab]
  useEffect(() => {
    if (!sheet) document.querySelector('aside')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sheet])

  return (
    <EachHook items={tabs} use={(tab) => tab.useVisible ?? always}>
      {(visible) => <Panel tabs={tabs.filter((_, i) => visible[i])} sheet={sheet} />}
    </EachHook>
  )
}

// the touch viewer's way to the same panel (files, chat, settings): over the whole screen, opened
// from its controls
export function SideSheet() {
  const { t } = useTranslation()
  const app = useApp()
  const close = () => app.setState({ sheet: false })
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        <DialogOverlay className="bg-black" />
        <DialogContent
          className="inset-0 flex translate-x-0 translate-y-0 flex-col bg-background-primary pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          aria-describedby={undefined}
          data-testid="side-sheet"
        >
          <DialogTitle className="sr-only">{t('phone.panel')}</DialogTitle>
          <div className="flex justify-end px-3 pt-2">
            <IconButton label={t('phone.panel_close')} className="size-11 rounded-full text-white" onClick={close}>
              <XIcon className="size-6" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1">
            <Side sheet />
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}

// the tabs available now
function Panel({ tabs, sheet }: { tabs: PluginTab[]; sheet: boolean }) {
  const { t } = useTranslation()
  const app = useApp()
  const wanted = useStore(app, (s) => s.tab)
  // a remembered tab that is not available now falls back to the first one
  const tab = tabs.some((x) => x.id === wanted) ? wanted : tabs[0].id
  const Page = tabs.find((x) => x.id === tab)!.component

  return (
    <Tabs value={tab} onValueChange={(id) => (app.setState({ tab: id }), remember('tab', id))} asChild>
      <aside
        className={
          sheet
            ? 'flex h-full min-h-0 w-full flex-col bg-background-primary'
            : 'tablet:w-full tablet:portrait:h-[60vh] tablet:landscape:h-screen flex max-h-full w-side max-w-full shrink-0 flex-col bg-background-primary'
        }
        data-testid="side"
      >
        <TabsList data-testid="tabs">
          {tabs.map(({ id, icon: Icon, label }) => (
            <TabsTrigger key={id} value={id}>
              <Icon className="mr-1 inline size-2.5" />
              <span>{t(label)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="flex max-h-full grow overflow-auto pt-[5px]">
          <Page />
        </TabsContent>
      </aside>
    </Tabs>
  )
}
