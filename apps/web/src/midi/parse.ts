export interface MidiNoteMessage {
  type: 'noteon' | 'noteoff'
  pitch: number
  velocity: number
}

/**
 * Web MIDI API onmidimessage 이벤트의 data를 파싱해 noteon/noteoff 메시지를 반환한다.
 *
 * - 0x9n (noteon): velocity > 0이면 noteon, velocity = 0이면 noteoff로 정규화.
 * - 0x8n (noteoff): noteoff 반환.
 * - 그 외 (CC / Aftertouch / PitchBend / SysEx 등): null 반환.
 *
 * 채널(상태 바이트 하위 니블)은 무시한다.
 */
export function parseMidiMessage(data: Uint8Array | number[]): MidiNoteMessage | null {
  if (data.length < 1) return null
  const status = data[0] ?? 0
  const pitch = data[1] ?? 0
  const velocity = data[2] ?? 0

  const msgType = status & 0xf0 // 채널 니블 제거

  if (msgType === 0x90) {
    if (velocity === 0) return { type: 'noteoff', pitch, velocity: 0 }
    return { type: 'noteon', pitch, velocity }
  }
  if (msgType === 0x80) {
    return { type: 'noteoff', pitch, velocity }
  }
  return null
}
