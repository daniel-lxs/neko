// ?back=<url>: where the viewer was opened from (say, a list of rooms), shown as a Back link in the
// header and in the touch viewer. Only a page of this viewer's own origin is accepted, so a link
// can't send the viewer to another site or run javascript:. The parameter stays in the address,
// so a reload keeps the link.
export function backLink(href = location.href): string | null {
  const value = new URL(href).searchParams.get('back')
  if (!value) return null
  try {
    const url = new URL(value, href)
    const origin = new URL(href).origin
    return url.origin === origin && /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
