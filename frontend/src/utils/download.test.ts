import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveFile } from './download'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('saveFile', () => {
  it('clicks a hidden link to an address made for the file, with the name to save it under', () => {
    const create = vi.fn(() => 'blob:abc')
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
    const seen: { connected: boolean; hidden: boolean; href: string; download: string }[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({
        connected: this.isConnected,
        hidden: this.hidden === true,
        href: this.getAttribute('href') ?? '',
        download: this.download,
      })
    })
    const blob = new Blob(['a,b'], { type: 'text/csv' })

    saveFile(blob, 'historial.csv')

    expect(create).toHaveBeenCalledExactlyOnceWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    // At the moment of the click the link is in the page, hidden, and points at the file
    expect(seen).toEqual([
      { connected: true, hidden: true, href: 'blob:abc', download: 'historial.csv' },
    ])
  })

  it('leaves nothing behind in the page', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:abc', revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    saveFile(new Blob(['x']), 'a.csv')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('releases the address once the download has started, not before', () => {
    vi.useFakeTimers()
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:abc', revokeObjectURL: revoke })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    saveFile(new Blob(['x']), 'a.csv')
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:abc')
  })
})
