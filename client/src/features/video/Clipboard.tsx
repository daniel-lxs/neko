import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useTranslation } from 'react-i18next'
import { useClient } from '@/state/provider'
import { PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

// textarea fallback for browsers that cannot read the local clipboard (see Stage.tsx), a popover
// left of the icon that opens it
export function Clipboard() {
  const client = useClient()
  const { t } = useTranslation()
  const remote = useStore(client.store, (s) => s.control.clipboard?.text ?? '')
  const locked = useStore(client.store, (s) => s.control.locked)
  const [text, setText] = useState(remote)
  useEffect(() => setText(remote), [remote]) // follows what is copied on the remote while open
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <PopoverContent
      side="left"
      align="end"
      className="flex w-[330px] max-w-[calc(100vw-20px)] flex-col gap-1 rounded-[3.5px] bg-background-primary p-[5px]"
      data-testid="clipboard"
    >
      <textarea
        className="h-[120px] w-full resize-y border-0 bg-transparent text-text-normal outline-hidden selection:bg-text-normal"
        aria-label="Clipboard"
        value={text}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const value = e.target.value
          setText(value)
          clearTimeout(timer.current)
          timer.current = window.setTimeout(() => client.send('clipboard/set', { text: value }), 500)
        }}
      />
      <Button
        type="button"
        className="min-h-11 self-end px-3 disabled:cursor-default disabled:opacity-50"
        disabled={!text || locked}
        onClick={() => {
          clearTimeout(timer.current)
          if (text && client.controlling && !client.state.control.locked) client.paste(text)
        }}
      >
        {t('controls.paste')}
      </Button>
    </PopoverContent>
  )
}
