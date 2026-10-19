import { describe, expect, it } from 'vitest'
import { readClipboardText } from './clipboard'

// a clipboard as the browser hands it to the page: items with their types, and readText() as WebKit
// implements it (text/plain only, URLs ignored)
const clipboard = (...items: Record<string, string>[]) =>
  ({
    read: async () =>
      items.map((data) => ({
        types: Object.keys(data),
        getType: async (type: string) => new Blob([data[type]], { type }),
      })),
    readText: async () => items.find((data) => 'text/plain' in data)?.['text/plain'] ?? '',
  }) as unknown as Clipboard

describe('readClipboardText', () => {
  it("pastes a copied link, which iOS keeps only as a URL that readText() doesn't return", async () => {
    const link = clipboard({ 'text/uri-list': 'https://example.com/a?b=1' })
    expect(await link.readText()).toBe('')
    expect(await readClipboardText(link)).toBe('https://example.com/a?b=1')
  })
  it('takes the first URI of a list, skipping comments and blank lines', async () => {
    const list = clipboard({ 'text/uri-list': '# from Safari\r\n\r\nhttps://a.example/\r\nhttps://b.example/' })
    expect(await readClipboardText(list)).toBe('https://a.example/')
  })
  it('prefers plain text over the URL, also from a later item', async () => {
    expect(await readClipboardText(clipboard({ 'text/uri-list': 'https://x.example/', 'text/plain': 'Title' }))).toBe(
      'Title',
    )
    expect(await readClipboardText(clipboard({ 'text/uri-list': 'https://x.example/' }, { 'text/plain': 'hi' }))).toBe(
      'hi',
    )
  })
  it('falls back to the URL when the plain text is empty', async () => {
    expect(await readClipboardText(clipboard({ 'text/plain': '', 'text/uri-list': 'https://x.example/' }))).toBe(
      'https://x.example/',
    )
  })
  it('is empty when there is no text at all', async () => {
    expect(await readClipboardText(clipboard({ 'image/png': 'png' }))).toBe('')
    expect(await readClipboardText(clipboard())).toBe('')
  })
  it('uses readText() where read() is missing, and passes a refusal on', async () => {
    expect(await readClipboardText({ readText: async () => 'old' } as unknown as Clipboard)).toBe('old')
    const denied = { read: () => Promise.reject(new DOMException('', 'NotAllowedError')) } as unknown as Clipboard
    await expect(readClipboardText(denied)).rejects.toThrow()
  })
})
