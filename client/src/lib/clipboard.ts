// The text a paste should type, from one clipboard read (Safari asks once per read). readText()
// is not enough on iOS: WebKit's readText() takes only text/plain and skips URLs, and Copy Link or
// the share sheet's Copy leaves just a URL (public.url, which the page sees as text/uri-list), so
// it resolves '' although the keyboard offers to paste. read() exposes the items: plain text
// first, else the URL.
export async function readClipboardText(clipboard: Clipboard = navigator.clipboard): Promise<string> {
  if (typeof clipboard.read !== 'function') return clipboard.readText()
  const items = await clipboard.read()
  for (const type of ['text/plain', 'text/uri-list']) {
    for (const item of items) {
      if (!item.types.includes(type)) continue
      const text = await (await item.getType(type)).text()
      const value = type === 'text/uri-list' ? firstUri(text) : text
      if (value) return value
    }
  }
  return ''
}

// text/uri-list: one URI per line, '#' lines are comments (RFC 2483)
const firstUri = (list: string) =>
  list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) ?? ''

export const canReadClipboardText = () =>
  window.isSecureContext &&
  (typeof navigator.clipboard?.read === 'function' || typeof navigator.clipboard?.readText === 'function')
