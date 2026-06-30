import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMidi } from '../useMidi'

// ── 가짜 MIDIAccess 픽스처 ────────────────────────────────────
type MidiHandler = ((e: { data: Uint8Array }) => void) | null

function makeFakeInput(id: string, name: string) {
  let _handler: MidiHandler = null
  return {
    id,
    name,
    get onmidimessage(): MidiHandler {
      return _handler
    },
    set onmidimessage(fn: MidiHandler) {
      _handler = fn
    },
    _dispatch(data: Uint8Array) {
      _handler?.({ data })
    },
  }
}

const fakeInput1 = makeFakeInput('device-1', 'Test Piano')
const fakeInput2 = makeFakeInput('device-2', 'Test Drum')

const fakeMIDIAccess = {
  inputs: new Map([
    ['device-1', fakeInput1],
    ['device-2', fakeInput2],
  ]),
  outputs: new Map(),
  onstatechange: null as ((e: unknown) => void) | null,
}

// ── beforeEach: navigator 스텁 ────────────────────────────────
beforeEach(() => {
  vi.stubGlobal('navigator', {
    requestMIDIAccess: vi.fn().mockResolvedValue(fakeMIDIAccess),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  fakeInput1.onmidimessage = null
  fakeInput2.onmidimessage = null
})

describe('useMidi', () => {
  it('마운트 시 requestMIDIAccess를 호출하고 장치 목록을 반환한다', async () => {
    const { result } = renderHook(() => useMidi(() => {}))
    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })
    expect(result.current.devices[0]!.name).toBe('Test Piano')
    expect(result.current.devices[1]!.name).toBe('Test Drum')
    expect(result.current.isSupported).toBe(true)
    expect(result.current.accessError).toBeNull()
  })

  it('selectDevice 후 해당 장치의 MIDI 메시지가 콜백으로 전달된다', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useMidi(onMessage))

    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })

    act(() => {
      result.current.selectDevice('device-1')
    })

    // noteon 메시지 디스패치
    act(() => {
      fakeInput1._dispatch(new Uint8Array([0x90, 60, 100]))
    })

    expect(onMessage).toHaveBeenCalledWith({ type: 'noteon', pitch: 60, velocity: 100 })
  })

  it('parseMidiMessage가 null 반환하는 메시지(CC 등)는 콜백을 호출하지 않는다', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useMidi(onMessage))
    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })
    act(() => {
      result.current.selectDevice('device-1')
    })

    // Control Change → null → 콜백 없음
    act(() => {
      fakeInput1._dispatch(new Uint8Array([0xb0, 7, 127]))
    })
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('장치 선택 해제(null) 시 메시지 수신이 중단된다', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useMidi(onMessage))
    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })

    act(() => {
      result.current.selectDevice('device-1')
    })
    act(() => {
      result.current.selectDevice(null)
    })
    act(() => {
      fakeInput1._dispatch(new Uint8Array([0x90, 60, 100]))
    })

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('navigator.requestMIDIAccess가 없으면 isSupported=false, devices=[]', () => {
    vi.unstubAllGlobals()
    // requestMIDIAccess 없는 navigator
    vi.stubGlobal('navigator', {})

    const { result } = renderHook(() => useMidi(() => {}))

    expect(result.current.isSupported).toBe(false)
    expect(result.current.devices).toEqual([])
  })

  // A-1: 장치 핫플러그 — statechange 후 devices 갱신
  it('hotplug: statechange 이후 devices가 새 장치를 포함해 갱신된다', async () => {
    const hotInput1 = makeFakeInput('device-1', 'Test Piano')
    const hotInputs = new Map<string, ReturnType<typeof makeFakeInput>>([['device-1', hotInput1]])
    const hotAccess = {
      inputs: hotInputs,
      onstatechange: null as ((e: unknown) => void) | null,
    }
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(hotAccess),
    })

    const { result } = renderHook(() => useMidi(() => {}))

    await waitFor(() => {
      expect(result.current.devices).toHaveLength(1)
    })

    // 새 장치 추가 후 statechange 트리거
    const hotInput2 = makeFakeInput('device-2', 'Test Drum')
    hotInputs.set('device-2', hotInput2)
    act(() => {
      hotAccess.onstatechange?.({})
    })

    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })
    expect(result.current.devices.map((d) => d.id)).toContain('device-2')
  })

  // A-2: 언마운트 시 onmidimessage 해제
  it('unmount 후 장치 메시지가 onMessage를 호출하지 않는다', async () => {
    const onMessage = vi.fn()
    const { result, unmount } = renderHook(() => useMidi(onMessage))

    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })
    act(() => {
      result.current.selectDevice('device-1')
    })

    unmount()

    // 언마운트 후 메시지 수신 → 콜백 미호출
    act(() => {
      fakeInput1._dispatch(new Uint8Array([0x90, 60, 100]))
    })
    expect(onMessage).not.toHaveBeenCalled()
  })

  // B-1: 접근 거부 에러 처리
  it('requestMIDIAccess 거부 시 accessError=SecurityError, devices=[]', async () => {
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockRejectedValue(new DOMException('denied', 'SecurityError')),
    })

    const { result } = renderHook(() => useMidi(() => {}))

    await waitFor(() => {
      expect(result.current.accessError).toBe('SecurityError')
    })
    expect(result.current.devices).toEqual([])
  })

  // B-2: 장치 전환 시 이전 장치 메시지 미수신, 새 장치 메시지 수신
  it('장치 전환: 이전 장치 메시지는 무시하고 새 장치 메시지만 수신한다', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useMidi(onMessage))

    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })

    act(() => {
      result.current.selectDevice('device-1')
    })
    act(() => {
      result.current.selectDevice('device-2')
    })

    // device-1 메시지 → 수신 안 됨
    act(() => {
      fakeInput1._dispatch(new Uint8Array([0x90, 60, 100]))
    })
    expect(onMessage).not.toHaveBeenCalled()

    // device-2 메시지 → 수신
    act(() => {
      fakeInput2._dispatch(new Uint8Array([0x90, 60, 100]))
    })
    expect(onMessage).toHaveBeenCalledWith({ type: 'noteon', pitch: 60, velocity: 100 })
  })

  // B-3: onMessage prop 변경 후 새 콜백만 호출 (stale closure 방지)
  it('onMessage prop 변경 후 새 콜백만 호출된다 (stale closure 방지)', async () => {
    const onMessage1 = vi.fn()
    const onMessage2 = vi.fn()
    let cb = onMessage1
    const { result, rerender } = renderHook(() => useMidi(cb))

    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })
    act(() => {
      result.current.selectDevice('device-1')
    })

    // 콜백 교체 후 rerender
    cb = onMessage2
    rerender()

    act(() => {
      fakeInput1._dispatch(new Uint8Array([0x90, 60, 100]))
    })
    expect(onMessage2).toHaveBeenCalledWith({ type: 'noteon', pitch: 60, velocity: 100 })
    expect(onMessage1).not.toHaveBeenCalled()
  })
})
