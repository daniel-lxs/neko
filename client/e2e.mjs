import { chromium } from 'playwright'
// Two-user smoke test against a running v3 server with the multiuser provider:
//   NEKO_URL=https://host/ NEKO_ADMIN_PASSWORD=admin NEKO_USER_PASSWORD=neko npm run test:e2e
// Screenshots land in ./e2e-out. Needs a KDE/X desktop that opens KRunner on Alt+F2 for the typing step.
import fs from 'node:fs'
const out = 'e2e-out'
fs.mkdirSync(out, { recursive: true })
const URL = process.env.NEKO_URL || 'http://localhost:8080/'
const ADMIN = process.env.NEKO_ADMIN_PASSWORD || 'admin'
const USER = process.env.NEKO_USER_PASSWORD || 'neko'
// NEKO_CDP=http://127.0.0.1:9222 runs the same steps in a real Chromium-based browser (Brave, Chrome, Edge)
// started with --remote-debugging-port and the three flags below
const browser = process.env.NEKO_CDP
  ? await chromium.connectOverCDP(process.env.NEKO_CDP)
  : await chromium.launch({
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    })
const errors = []
let A, B
let fails = 0
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s)
async function step(name, fn) {
  try {
    await fn()
    log('PASS ' + name)
  } catch (e) {
    fails++
    log('FAIL ' + name + ' :: ' + e.message.split('\n')[0])
    // evidence for flaky failures: both users' screens and what their control pill says
    const slug = name.replace(/\W+/g, '-')
    for (const [who, p] of [
      ['alice', A],
      ['bob', B],
    ]) {
      if (!p) continue
      await p.screenshot({ path: `${out}/fail-${slug}-${who}.png` }).catch(() => {})
      const status = await p
        .locator('[data-testid=control-status]')
        .textContent({ timeout: 1000 })
        .catch(() => '?')
      log(`  ${who} control: ${JSON.stringify(status)}`)
    }
  }
}
async function user(name, password, init) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1400, height: 850 },
    permissions: ['clipboard-read', 'clipboard-write', 'microphone'],
  })
  if (init) await ctx.addInitScript(init) // runs before the app: a browser quirk to emulate
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      // the outage steps make the socket fail on purpose; Brave reports that without the ERR_ text
      !/401|STUN|ERR_INTERNET_DISCONNECTED|WebSocket connection to .* failed/.test(m.text()) &&
      errors.push(`${name} console: ${m.text()}`),
  )
  await page.goto(URL)
  await page.fill('input[placeholder="Enter your display name"]', name)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 20000 })
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video')
      return v && !v.paused && v.readyState >= 2
    },
    null,
    { timeout: 30000 },
  )
  return page
}
const api = (p, method, path, body) =>
  p.evaluate(
    async ([method, path, body]) => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + localStorage.getItem('neko_session'),
      }
      const r = await fetch('api' + path, { method, headers, body: body && JSON.stringify(body) })
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()))
      return r.text()
    },
    [method, path, body],
  )
// The viewer is the stream and the control pill under it. The side panel (chat, files, settings)
// is a sheet opened from the pill's More menu, which only shows while you have control: openSide
// takes control for a moment (alice, the admin, hands it over when someone else has it), opens
// the tab and gives control back, so the sheet stays open with nobody in control.
const sessionId = async (name) =>
  JSON.parse(await api(A, 'GET', '/sessions')).find((s) => s.profile.name === name && s.state.is_connected).id
const connectedNames = async () =>
  JSON.parse(await api(A, 'GET', '/sessions'))
    .filter((s) => s.state.is_connected)
    .map((s) => s.profile.name)
    .sort()
const hosting = (p) => p.waitForSelector('[data-testid=control-bar][data-hosting]', { timeout: 5000 })
const notHosting = (p) => p.waitForSelector('[data-testid=control-bar]:not([data-hosting])', { timeout: 5000 })
const status = (p, re) =>
  p.waitForFunction(
    (src) => new RegExp(src).test(document.querySelector('[data-testid=control-status]')?.textContent ?? ''),
    re.source,
    { timeout: 5000 },
  )
const closeSide = async (p) => {
  if (!(await p.locator('[data-testid=side-sheet]').count())) return
  await p.click('[data-testid=side-sheet] [aria-label="Close panel"]')
  await p.waitForSelector('[data-testid=side-sheet]', { state: 'detached', timeout: 3000 })
}
const takeControl = async (p, name) => {
  await closeSide(p)
  if (await p.locator('[data-testid=control-bar][data-hosting]').count()) return
  const { has_host } = JSON.parse(await api(A, 'GET', '/room/control'))
  if (has_host) await api(A, 'POST', '/room/control/give/' + encodeURIComponent(await sessionId(name)))
  else await p.click('[data-testid=control-toggle]')
  await hosting(p)
}
const openSide = async (p, name, tab = 'chat') => {
  if (!(await p.locator('[data-testid=side-sheet]').count())) {
    await takeControl(p, name)
    await p.click('[data-testid=phone-more]')
    await p.click(`[data-testid=phone-menu-${tab}]`)
    await p.waitForSelector('[data-testid=side-sheet]', { timeout: 3000 })
    await api(p, 'POST', '/room/control/release')
    await notHosting(p)
  }
  await p.waitForSelector('[data-testid=side]', { timeout: 3000 })
}
const playing = (p) =>
  p.evaluate(() => {
    const v = document.querySelector('video')
    return `${v.videoWidth}x${v.videoHeight} paused=${v.paused} muted=${v.muted}`
  })
const chatEvent = (p, re) =>
  p.waitForFunction(
    (src) =>
      [...document.querySelectorAll('[data-testid=chat-event]')].some((e) => new RegExp(src).test(e.textContent)),
    re.source,
    { timeout: 5000 },
  )
// the member menu: the member list is gone, so it opens from the author of a chat message
const memberMenu = async (p, author, item) => {
  await p.locator('[data-testid=chat-author]', { hasText: author }).last().click({ button: 'right' })
  await p.click(`[data-testid=member-menu] >> text=${item}`)
}

await step('alice (admin) logs in, video plays', async () => {
  A = await user('alice', ADMIN)
  log('  alice video ' + (await playing(A)))
})
await step('bob (user) logs in, video plays', async () => {
  B = await user('bob', USER)
  log('  bob video ' + (await playing(B)))
})
await step('both are connected; the viewer is only the stream and the pill', async () => {
  const names = await connectedNames()
  if (JSON.stringify(names) !== '["alice","bob"]') throw new Error('connected: ' + JSON.stringify(names))
  for (const p of [A, B]) {
    await status(p, /has control/)
    for (const gone of ['header', 'room-bar', 'phone-more', 'control-tools'])
      if (await p.locator(`[data-testid=${gone}]`).count()) throw new Error(gone + ' shown while watching')
  }
})
await step('side panel: bob joined event line', async () => {
  await openSide(A, 'alice')
  await A.waitForSelector('[data-testid=chat]', { timeout: 3000 })
  await chatEvent(A, /bob\s+connected/)
})
await step('chat: bob -> alice', async () => {
  await openSide(B, 'bob')
  await B.fill('[data-testid=chat-input]', 'hi from bob')
  await B.press('[data-testid=chat-input]', 'Enter')
  await A.waitForFunction(
    () => [...document.querySelectorAll('[data-testid=chat-body]')].some((e) => e.textContent === 'hi from bob'),
    null,
    { timeout: 5000 },
  )
})
await step('bob takes over with the pill, alice sees it + event', async () => {
  await closeSide(B)
  await status(B, /has control/)
  await B.click('[data-testid=control-toggle]')
  await hosting(B)
  await status(B, /You have control/)
  await B.waitForSelector('[data-testid=control-toggle] >> text=Return control', { timeout: 3000 })
  await B.waitForSelector('[data-testid=phone-more]', { timeout: 3000 })
  await status(A, /bob has control/)
  await chatEvent(A, /bob\s+took the controls/)
})
await step('alice: right-click bob in chat -> Force Release', async () => {
  await memberMenu(A, 'bob', 'Force Release Controls')
  await notHosting(B)
  if (await B.locator('[data-testid=phone-more]').count()) throw new Error('More menu shown without control')
})
await step('bob returns control with the pill', async () => {
  await B.click('[data-testid=control-toggle]')
  await hosting(B)
  await B.click('[data-testid=control-toggle]')
  await notHosting(B)
  await status(A, /has control/)
})
await step('files: alice uploads, the list shows the file', async () => {
  if (!(await A.locator('[data-testid=tabs] >> text=Files').count()))
    throw new Error('no Files tab: start the server with NEKO_FILETRANSFER_ENABLED=true')
  await A.click('[data-testid=tabs] >> text=Files')
  await A.setInputFiles('[data-testid=upload-input]', {
    name: 'react-e2e.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  await A.waitForSelector('[data-testid=transfer][data-status=completed]', { timeout: 10000 })
  await A.waitForSelector('[data-testid=file-name] >> text=react-e2e.txt', { timeout: 5000 })
})
await step('files: download link works', async () => {
  const href = await A.getAttribute('[data-testid=file]:has-text("react-e2e.txt") a[download]', 'href')
  const r = await A.request.get(href)
  if ((await r.text()) !== 'hello') throw new Error('download body mismatch: ' + r.status())
  await A.click('[data-testid=file]:has-text("react-e2e.txt") [data-testid=file-delete]')
  await A.click('[data-testid=dialog-confirm]')
  await A.waitForSelector('[data-testid=file-name] >> text=react-e2e.txt', { state: 'detached', timeout: 5000 })
})
await step('markdown: bob -> alice renders safely', async () => {
  await openSide(B, 'bob')
  await B.click('[data-testid=tabs] >> text=Chat')
  await B.fill('[data-testid=chat-input]', '**bold** ||secret|| :smile: https://example.com [x](javascript:alert(1))')
  await B.press('[data-testid=chat-input]', 'Enter')
  await A.click('[data-testid=tabs] >> text=Chat')
  const last = A.locator('[data-testid=chat-body]').last()
  await last.locator('strong >> text=bold').waitFor({ timeout: 5000 })
  await last.locator('[data-testid=spoiler]:not([data-shown])').click()
  await last.locator('[data-testid=spoiler][data-shown]').waitFor({ timeout: 2000 })
  await last.locator('[data-emoji="smile"]').waitFor({ timeout: 5000 })
  if ((await last.locator('a').count()) !== 1) throw new Error('expected exactly one (safe) link')
  if ((await last.locator('a').getAttribute('href')) !== 'https://example.com/') throw new Error('bad href')
})
await step('narrow screen: the member menu opens from a chat author', async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 700, height: 900 } })
  const N = await ctx.newPage()
  await N.goto(URL + '?usr=nina&pwd=' + USER)
  await N.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 20000 })
  await openSide(N, 'nina')
  await B.fill('[data-testid=chat-input]', 'hi nina')
  await B.press('[data-testid=chat-input]', 'Enter')
  await N.waitForSelector('[data-testid=chat-author]', { timeout: 5000 })
  await N.click('[data-testid=chat-author]', { button: 'right' })
  await N.waitForSelector('[data-testid=member-menu]', { state: 'visible', timeout: 3000 })
  await ctx.close()
})
await step('emoji picker inserts :name:', async () => {
  await A.click('[data-testid=emoji-open]')
  await A.fill('[data-testid=emoji-search]', 'thumbsup')
  await A.click('[data-testid=emoji-list] [data-emoji] >> nth=0')
  const v = await A.inputValue('[data-testid=chat-input]')
  if (!/^:[^:]+:$/.test(v)) throw new Error('textarea is ' + JSON.stringify(v))
  // the keyboard stays in the message box after a pick (the picker's close must not focus its button)
  await A.keyboard.type('x')
  const v2 = await A.inputValue('[data-testid=chat-input]')
  if (!/^:[^:]+:x$/.test(v2)) throw new Error('after the pick the keyboard went elsewhere: ' + JSON.stringify(v2))
  await A.fill('[data-testid=chat-input]', '')
})
await step('admin locks controls: bob loses the Take over pill + event', async () => {
  await api(A, 'POST', '/room/settings', { locked_controls: true })
  await B.waitForSelector('[data-testid=control-toggle]', { state: 'detached', timeout: 5000 })
  await chatEvent(B, /alice\s+locked controls/)
  await api(A, 'POST', '/room/settings', { locked_controls: false })
  await B.waitForSelector('[data-testid=control-toggle]', { timeout: 5000 })
})
await step('admin mutes bob: input gone, event line; then unmute', async () => {
  await memberMenu(A, 'bob', 'Mute')
  await A.click('[data-testid=dialog-confirm]')
  await B.waitForSelector('[data-testid=chat-input]', { state: 'detached', timeout: 5000 })
  await chatEvent(A, /You\s+muted bob/)
  await memberMenu(A, 'bob', 'Unmute')
  await A.click('[data-testid=dialog-confirm]')
  await B.waitForSelector('[data-testid=chat-input]', { timeout: 5000 })
})
await step("a display name with # and ? cannot redirect the admin's mute", async () => {
  // multiuser session ids start with the login name; unencoded, this id would turn
  // POST /api/members/<id> into a request for a different path
  const E = await user('evil#?x', USER)
  await openSide(E, 'evil#?x')
  await E.fill('[data-testid=chat-input]', 'hi from evil')
  await E.press('[data-testid=chat-input]', 'Enter')
  await A.waitForSelector('[data-testid=chat-author] >> text=evil#?x', { timeout: 5000 })
  await memberMenu(A, 'evil#?x', 'Mute')
  await A.click('[data-testid=dialog-confirm]')
  await E.waitForSelector('[data-testid=chat-input]', { state: 'detached', timeout: 5000 })
  if (await A.locator('[data-testid=connect]').count()) throw new Error('admin lost the session')
  await E.context().close()
  for (let i = 0; i < 20 && (await connectedNames()).includes('evil#?x'); i++) await A.waitForTimeout(250)
  if ((await connectedNames()).includes('evil#?x')) throw new Error('evil#?x still connected')
})
await step('keyboard: Enter on the focused close button closes the side panel', async () => {
  await B.focus('[data-testid=side-sheet] [aria-label="Close panel"]')
  await B.keyboard.press('Enter')
  await B.waitForSelector('[data-testid=side-sheet]', { state: 'detached', timeout: 3000 })
  await openSide(B, 'bob')
})
await step('a member who may not watch gets the room without video, not a spinner', async () => {
  const bobId = await sessionId('bob')
  await api(A, 'POST', '/members/' + encodeURIComponent(bobId), { can_watch: false })
  try {
    await B.reload()
    await B.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 20000 }) // the offer timeout (8 s) ends the spinner
    await B.waitForSelector('[data-testid=control-status]', { timeout: 5000 })
  } finally {
    await api(A, 'POST', '/members/' + encodeURIComponent(bobId), { can_watch: true })
  }
  await B.reload()
  await B.waitForFunction(
    () => {
      const v = document.querySelector('video')
      return v && !v.paused && v.readyState >= 2
    },
    null,
    { timeout: 30000 },
  )
  await openSide(B, 'bob')
})
await step('admin changes resolution from the More menu, bob sees event; revert', async () => {
  await takeControl(A, 'alice')
  const pick = async (choose) => {
    await A.click('[data-testid=phone-more]')
    await A.click('[data-testid=phone-menu] >> text=Screen size')
    await A.waitForSelector('[data-testid=resolution-item]', { timeout: 3000 })
    await choose()
  }
  let current = ''
  const width = await A.evaluate(() => document.querySelector('video').videoWidth)
  await pick(async () => {
    current = (await A.locator('[data-testid=resolution-item][data-active]').textContent()) ?? ''
    await A.locator('[data-testid=resolution-item]').filter({ hasNotText: current }).first().click()
  })
  await B.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid=chat-event]')].some((e) =>
        /changed the resolution/.test(e.textContent),
      ),
    null,
    { timeout: 8000 },
  )
  await pick(() => A.locator('[data-testid=resolution-item]', { hasText: current }).first().click())
  await A.waitForFunction((w) => document.querySelector('video').videoWidth === w, width, { timeout: 15000 })
  await api(A, 'POST', '/room/control/release')
  await notHosting(A)
})
await step('settings: keyboard layouts loaded', async () => {
  await openSide(A, 'alice', 'settings')
  await A.click('[data-testid=tabs] >> text=Settings')
  const n = await A.locator('[data-testid=settings] select option').count()
  if (n < 20) throw new Error('only ' + n + ' keyboard layouts')
  await A.click('[data-testid=tabs] >> text=Chat')
})
await step('implicit hosting: bob gets control by clicking the stream', async () => {
  await api(A, 'POST', '/room/settings', { implicit_hosting: true })
  await closeSide(B)
  const box = await B.locator('[data-testid=player]').boundingBox()
  await B.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await hosting(B)
  await api(A, 'POST', '/room/settings', { implicit_hosting: false })
  await api(A, 'POST', '/room/control/reset')
  await notHosting(B)
})
await step('clipboard: local clipboard reaches the remote when hovering', async () => {
  await takeControl(A, 'alice')
  // give the X clipboard an owner first: reading it while nothing owns it is a server 500 (xclip
  // exits) that the browser logs as an error, which is not what this step is about
  await api(A, 'POST', '/room/clipboard', { text: 'seed' })
  const text = 'neko-clip-' + Date.now()
  await A.evaluate((t) => navigator.clipboard.writeText(t), text)
  await A.mouse.move(5, 5)
  const box = await A.locator('[data-testid=player]').boundingBox()
  await A.mouse.move(box.x + 50, box.y + 50)
  await A.waitForFunction(
    async (t) => {
      const headers = { Authorization: 'Bearer ' + localStorage.getItem('neko_session') }
      const r = await fetch('api/room/clipboard', { headers })
      return r.ok && (await r.json()).text === t
    },
    text,
    { timeout: 8000, polling: 500 },
  )
  await api(A, 'POST', '/room/control/release')
  await notHosting(A)
})
// the textarea fallback shows when the browser cannot read the local clipboard (Firefox, Safari):
// emulated by removing readText before the app loads
await step('clipboard fallback: the popover keeps the focus while the mouse crosses the video', async () => {
  const C = await user('carol', ADMIN, () =>
    Object.defineProperty(Clipboard.prototype, 'readText', { value: undefined }),
  )
  try {
    await C.click('[data-testid=control-toggle]')
    await hosting(C)
    await C.click('[data-testid=clipboard-open]')
    const inPopover = () => document.activeElement?.closest('[data-testid=clipboard] textarea') != null
    await C.waitForFunction(inPopover, null, { timeout: 3000 })
    const box = await C.locator('[data-testid=player]').boundingBox()
    await C.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
    await C.mouse.move(box.x + 40, box.y + box.height - 40, { steps: 12 })
    await C.waitForTimeout(500)
    if (!(await C.locator('[data-testid=clipboard]').count())) throw new Error('the clipboard popover closed')
    if (!(await C.evaluate(inPopover))) throw new Error('the clipboard textarea lost the focus')
    // what is typed lands in the textarea, not on the remote, and can be selected to copy
    await C.keyboard.type('neko-fallback')
    await C.keyboard.press('Control+A')
    const sel = await C.evaluate(() => {
      const t = document.activeElement
      return t.value === 'neko-fallback' && t.selectionEnd - t.selectionStart === t.value.length
    })
    if (!sel) throw new Error('typing or select-all did not reach the clipboard textarea')
    await C.keyboard.press('Escape')
    await C.waitForSelector('[data-testid=clipboard]', { state: 'detached', timeout: 3000 })
  } finally {
    await api(C, 'POST', '/room/control/release').catch(() => {})
    await C.context().close()
  }
})
// offline emulation only freezes an open websocket in Chromium (WebKit and Firefox keep delivering
// heartbeats to it, measured); elsewhere these two steps have nothing to notice and are skipped
const offlineWorks = browser.browserType().name() === 'chromium'
await step('network drop: bob notices the dead socket and reconnects', async () => {
  if (!offlineWorks) return log('  skipped: offline emulation does not reach the websocket here')
  // offline emulation freezes the websocket but not WebRTC: only the stale check (~25s) notices
  await B.context().setOffline(true)
  try {
    await B.waitForSelector('[data-testid=connect]', { timeout: 45000 })
  } finally {
    await B.context().setOffline(false)
  }
  await B.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 30000 })
  await B.waitForFunction(
    () => {
      const v = document.querySelector('video')
      return v && !v.paused && v.readyState >= 2
    },
    null,
    { timeout: 20000 },
  )
})
await step('long outage: session kept, Connect button instead of the login form', async () => {
  if (!offlineWorks) return log('  skipped: offline emulation does not reach the websocket here')
  // the core gives up after RECONNECT_MAX attempts (about 80 s); the session is still valid
  await B.context().setOffline(true)
  try {
    await B.waitForSelector('[data-testid=connect] form button[type=submit]', { timeout: 150000 })
  } finally {
    await B.context().setOffline(false)
  }
  if (await B.locator('[data-testid=connect] input[type=password]').count())
    throw new Error('thrown back to the login form')
  await B.click('[data-testid=dialog-confirm]') // "Disconnected: connection lost"
  await B.click('[data-testid=connect] form button[type=submit]')
  await B.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 30000 })
  await B.waitForFunction(
    () => {
      const v = document.querySelector('video')
      return v && !v.paused && v.readyState >= 2
    },
    null,
    { timeout: 20000 },
  )
})
await step('alice takes control and types into KDE', async () => {
  await takeControl(A, 'alice')
  const box = await A.locator('[data-testid=player]').boundingBox()
  await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await A.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3)
  // what arrived: select all and copy inside the remote, then read the remote clipboard
  const copyAll = async (settle = 600) => {
    await A.keyboard.press('Control+a')
    await A.keyboard.press('Control+c')
    await A.waitForTimeout(settle)
    return JSON.parse(await api(A, 'GET', '/room/clipboard')).text
  }
  await A.keyboard.press('Alt+F2')
  // KRunner is started by that shortcut and takes the keyboard focus only once it is up; a key
  // that lands on the focus change is lost. So type a probe and read it back until KRunner
  // demonstrably inserts keys, then type the text over the still selected probe
  const deadline = Date.now() + 15000
  for (;;) {
    await A.keyboard.type('x')
    if ((await copyAll(300).catch(() => '')) === 'x') break
    if (Date.now() > deadline) throw new Error('KRunner did not take the keyboard')
  }
  await A.keyboard.type('react gui works', { delay: 30 })
  await A.waitForTimeout(1200)
  await A.screenshot({ path: out + '/e2e-alice.png' })
  await B.screenshot({ path: out + '/e2e-bob.png' })
  const typed = await copyAll()
  if (typed !== 'react gui works') throw new Error('remote received ' + JSON.stringify(typed))
  // Ctrl+V inside the remote pastes what was copied there, with the real Ctrl held. Home collapses
  // the selection to the start; End would not: with the caret already at the end, KRunner's results
  // list takes it (milou ResultsView.qml navigationKeyHandler) and swallows the following Ctrl+V
  await A.keyboard.press('Home')
  await A.keyboard.press('Control+v')
  await A.waitForTimeout(800)
  const pasted = await copyAll()
  if (pasted !== 'react gui worksreact gui works')
    throw new Error('after Ctrl+V the field has ' + JSON.stringify(pasted))
  await A.keyboard.press('Escape')
})
await step('alice kicks bob -> bob back at login', async () => {
  await api(A, 'POST', '/room/control/release').catch(() => {})
  await openSide(A, 'alice')
  await A.click('[data-testid=tabs] >> text=Chat')
  await memberMenu(A, 'bob', 'Kick')
  await A.click('[data-testid=dialog-confirm]')
  await B.waitForSelector('[data-testid=connect] input[type=password]', { timeout: 8000 })
  await chatEvent(A, /bob\s+disconnected/)
  await B.screenshot({ path: out + '/e2e-bob-kicked.png' })
})
await step('url params: ?usr&pwd&lang auto-login, url cleaned, logout', async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  const C = await ctx.newPage()
  await C.goto(URL + '?usr=carol&pwd=' + USER + '&lang=de')
  await C.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 20000 })
  if (/pwd=/.test(C.url())) throw new Error('password left in url: ' + C.url())
  // the same browser profile opens another invite link while its session is still valid:
  // the new login must win on both the websocket and REST (no split identity)
  await C.goto(URL + '?usr=carol2&pwd=' + USER + '&lang=de')
  await C.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 20000 })
  // the browser closes the first page's socket on navigation; Firefox does so without a close
  // code and the server then keeps that session for its 5 s reconnect grace
  let connected
  for (let i = 0; i < 16; i++) {
    await C.waitForTimeout(500)
    connected = await connectedNames()
    if (connected.includes('carol2') && !connected.includes('carol')) break
  }
  if (!connected.includes('carol2') || connected.includes('carol'))
    throw new Error('connected sessions after the second invite: ' + JSON.stringify(connected))
  await openSide(C, 'carol2', 'settings')
  await C.waitForSelector('[data-testid=side] >> text=Einstellungen', { timeout: 5000 })
  await C.click('[data-testid=tabs] >> text=Einstellungen')
  await C.click('[data-testid=logout]')
  await C.waitForSelector('[data-testid=connect] input[type=password]', { timeout: 8000 })
  await ctx.close()
})
await step('url params: ?embed=1 keeps the pill, ?cast=1 shows the stream alone', async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  const C = await ctx.newPage()
  await C.goto(URL + '?embed=1&usr=dave&pwd=' + USER)
  await C.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 20000 })
  await C.waitForSelector('[data-testid=control-bar]', { timeout: 5000 })
  await C.goto(URL + '?cast=1&usr=dave&pwd=' + USER)
  await C.waitForSelector('[data-testid=connect]', { state: 'detached', timeout: 20000 })
  await C.waitForSelector('video', { timeout: 5000 })
  if (await C.locator('[data-testid=control-bar]').count()) throw new Error('control pill shown in cast mode')
  await ctx.close()
})
console.log(
  `\n${fails} failed. page errors:`,
  errors.length ? '\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ') : 'none',
)
await browser.close()
process.exit(fails || errors.length ? 1 : 0)
