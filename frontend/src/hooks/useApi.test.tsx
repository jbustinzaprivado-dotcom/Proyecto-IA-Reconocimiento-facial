import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '../types/facial'
import { useApi } from './useApi'

const ok = <T,>(resultado: T): ApiResponse<T> => ({ success: true, resultado })

describe('useApi', () => {
  it('starts loading and then exposes the data', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok(['a']))
    const { result } = renderHook(() => useApi(fetcher))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(['a'])
    expect(result.current.error).toBeNull()
  })

  it('exposes the API error and no data', async () => {
    const fetcher = vi.fn().mockResolvedValue({ success: false, error: 'Falló' })
    const { result } = renderHook(() => useApi(fetcher))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Falló')
    expect(result.current.data).toBeNull()
  })

  it('turns an unexpected exception into an error instead of loading forever', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useApi(fetcher))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Ocurrió un error inesperado.')
  })

  it('reloads on demand, going back to loading meanwhile', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Falló' })
      .mockResolvedValueOnce(ok('listo'))
    const { result } = renderHook(() => useApi(fetcher))
    await waitFor(() => expect(result.current.error).toBe('Falló'))

    act(() => result.current.reload())
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    await waitFor(() => expect(result.current.data).toBe('listo'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('starts over with a new fetcher: the data of the old one is never shown as current', async () => {
    const first = vi.fn().mockResolvedValue(ok('modelo A'))
    const second = vi.fn().mockResolvedValue(ok('modelo B'))
    const { result, rerender } = renderHook(({ fetcher }) => useApi(fetcher), {
      initialProps: { fetcher: first },
    })
    await waitFor(() => expect(result.current.data).toBe('modelo A'))

    rerender({ fetcher: second })
    // At once, before the new answer arrives: loading, and not the data of the other fetcher
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()

    await waitFor(() => expect(result.current.data).toBe('modelo B'))
    expect(result.current.loading).toBe(false)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('ignores the slow answer of the old fetcher when a new one has taken over', async () => {
    let resolveFirst: (value: ApiResponse<string>) => void = () => {}
    const first = vi.fn(() => new Promise<ApiResponse<string>>((r) => (resolveFirst = r)))
    const second = vi.fn().mockResolvedValue(ok('modelo B'))
    const { result, rerender } = renderHook(({ fetcher }) => useApi(fetcher), {
      initialProps: { fetcher: first as () => Promise<ApiResponse<string>> },
    })
    rerender({ fetcher: second })
    await waitFor(() => expect(result.current.data).toBe('modelo B'))

    await act(async () => resolveFirst(ok('modelo A')))
    expect(result.current.data).toBe('modelo B')
  })

  it('does not show the error of the old fetcher as the error of the new one', async () => {
    const first = vi.fn().mockResolvedValue({ success: false, error: 'Falló A' })
    const second = vi.fn().mockReturnValue(new Promise(() => {}))
    const { result, rerender } = renderHook(({ fetcher }) => useApi(fetcher), {
      initialProps: { fetcher: first as () => Promise<ApiResponse<string>> },
    })
    await waitFor(() => expect(result.current.error).toBe('Falló A'))

    rerender({ fetcher: second })
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('ignores a slow response from a previous attempt that arrives after a reload', async () => {
    let resolveFirst: (value: ApiResponse<string>) => void = () => {}
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ApiResponse<string>>((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(ok('segundo'))
    const { result } = renderHook(() => useApi(fetcher))

    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toBe('segundo'))

    await act(async () => resolveFirst(ok('primero')))
    expect(result.current.data).toBe('segundo')
    expect(result.current.loading).toBe(false)
  })
})
