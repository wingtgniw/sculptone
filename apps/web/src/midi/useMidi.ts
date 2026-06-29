import { useCallback, useEffect, useRef, useState } from 'react'
import { parseMidiMessage, type MidiNoteMessage } from './parse'

export interface MidiDevice {
  id: string
  name: string
}

// 브라우저 MIDIAccess의 최소 구조 타입 — MIDIInputMap 은 ReadonlyMap 이므로
// Map<K,V> 전체와 호환되지 않음. forEach 만 요구해 테스트(Map)·브라우저 모두 대응.
type MIDIInputLike = {
  id: string
  name: string | null
  onmidimessage: ((e: { data: Uint8Array }) => void) | null
}

type MIDIAccessLike = {
  inputs: {
    forEach: (cb: (input: MIDIInputLike, key: string) => void) => void
  }
  onstatechange: ((e: unknown) => void) | null
}

// Navigator 에는 이미 requestMIDIAccess?: () => Promise<MIDIAccess> 가 선언돼 있어
// intersection 으로 타입을 좁히면 MIDIAccess ↔ MIDIAccessLike 불일치가 발생한다.
// unknown → 커스텀 타입으로 이중 캐스트해 충돌을 피한다.
type NavWithMidi = {
  requestMIDIAccess?: () => Promise<MIDIAccessLike>
}

export function useMidi(onMessage: (msg: MidiNoteMessage) => void) {
  const [devices, setDevices] = useState<MidiDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)

  const accessRef = useRef<MIDIAccessLike | null>(null)
  // stable callback ref — onMessage prop 이 바뀌어도 핸들러 재등록 불필요
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  useEffect(() => {
    const nav = navigator as unknown as NavWithMidi
    if (!nav.requestMIDIAccess) {
      setIsSupported(false)
      return
    }
    let mounted = true
    nav
      .requestMIDIAccess()
      .then((access) => {
        if (!mounted) return
        accessRef.current = access
        const devs: MidiDevice[] = []
        access.inputs.forEach((input) => {
          devs.push({ id: input.id, name: input.name ?? '' })
        })
        setDevices(devs)

        // A-1: 장치 핫플러그/분리 감지 — inputs 재열거 후 state 갱신
        access.onstatechange = () => {
          if (!mounted) return
          const newDevs: MidiDevice[] = []
          access.inputs.forEach((input) => {
            newDevs.push({ id: input.id, name: input.name ?? '' })
          })
          setDevices(newDevs)
          // 현재 선택 장치가 사라졌으면 선택 해제
          setSelectedDeviceId((prev) => {
            if (prev === null) return null
            let found = false
            access.inputs.forEach((input) => {
              if (input.id === prev) found = true
            })
            return found ? prev : null
          })
        }
      })
      .catch((err: Error) => {
        if (!mounted) return
        setAccessError(err.name ?? 'Unknown error')
      })
    return () => {
      mounted = false
      if (accessRef.current) {
        // A-1: onstatechange 해제
        accessRef.current.onstatechange = null
        // A-2: 언마운트 시 onmidimessage 핸들러 해제
        accessRef.current.inputs.forEach((i) => { i.onmidimessage = null })
      }
    }
  }, [])

  const selectDevice = useCallback((id: string | null) => {
    setSelectedDeviceId(id)
    if (!accessRef.current) return
    accessRef.current.inputs.forEach((input) => {
      if (input.id === id) {
        input.onmidimessage = (e) => {
          const msg = parseMidiMessage(e.data)
          if (msg) onMessageRef.current(msg)
        }
      } else {
        input.onmidimessage = null
      }
    })
  }, [])

  return { devices, selectedDeviceId, selectDevice, isSupported, accessError }
}
