import { test } from 'vitest'
import assert from 'node:assert/strict'
import { backLink } from './back.ts'

const at = 'https://browser.example/rooms/codex/'

test('no parameter, no link', () => {
  assert.equal(backLink(at), null)
  assert.equal(backLink(at + '?back='), null)
})

test('same-origin paths, relative or absolute', () => {
  assert.equal(backLink(at + '?back=/rooms/'), 'https://browser.example/rooms/')
  assert.equal(backLink(at + '?back=..%2F'), 'https://browser.example/rooms/')
  assert.equal(
    backLink(at + '?back=' + encodeURIComponent('https://browser.example/x?y=1')),
    'https://browser.example/x?y=1',
  )
})

test('other origins and schemes are refused', () => {
  for (const v of [
    'https://evil.example/',
    '//evil.example/',
    'javascript:alert(1)',
    'data:text/html,x',
    'http://browser.example/',
  ])
    assert.equal(backLink(at + '?back=' + encodeURIComponent(v)), null, v)
})
