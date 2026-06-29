import { describe, it, expect } from 'vitest'
import { parseMidiMessage } from '../parse'

describe('parseMidiMessage', () => {
  // ── noteon ────────────────────────────────────────────────────

  it('0x90 (ch1) + velocity>0 → noteon 반환', () => {
    const result = parseMidiMessage([0x90, 60, 100])
    expect(result).toEqual({ type: 'noteon', pitch: 60, velocity: 100 })
  })

  it('0x91 (ch2) → 채널 무시하고 noteon 반환', () => {
    const result = parseMidiMessage([0x91, 64, 80])
    expect(result).toEqual({ type: 'noteon', pitch: 64, velocity: 80 })
  })

  it('0x9F (ch16) → 채널 무시하고 noteon 반환', () => {
    const result = parseMidiMessage([0x9F, 48, 64])
    expect(result).toEqual({ type: 'noteon', pitch: 48, velocity: 64 })
  })

  // ── velocity=0 정규화 ─────────────────────────────────────────

  it('0x90 velocity=0 → noteoff로 정규화', () => {
    const result = parseMidiMessage([0x90, 60, 0])
    expect(result).toEqual({ type: 'noteoff', pitch: 60, velocity: 0 })
  })

  // ── noteoff ───────────────────────────────────────────────────

  it('0x80 (ch1) → noteoff 반환', () => {
    const result = parseMidiMessage([0x80, 60, 0])
    expect(result).toEqual({ type: 'noteoff', pitch: 60, velocity: 0 })
  })

  it('0x83 (ch4) → 채널 무시하고 noteoff 반환', () => {
    const result = parseMidiMessage([0x83, 72, 40])
    expect(result).toEqual({ type: 'noteoff', pitch: 72, velocity: 40 })
  })

  // ── 무시할 메시지들 ──────────────────────────────────────────

  it('0xB0 Control Change → null', () => {
    expect(parseMidiMessage([0xB0, 7, 127])).toBeNull()
  })

  it('0xA0 Aftertouch → null', () => {
    expect(parseMidiMessage([0xA0, 60, 64])).toBeNull()
  })

  it('0xE0 Pitch Bend → null', () => {
    expect(parseMidiMessage([0xE0, 0, 64])).toBeNull()
  })

  // ── Uint8Array 입력 ───────────────────────────────────────────

  it('Uint8Array 입력도 동일하게 동작한다', () => {
    const result = parseMidiMessage(new Uint8Array([0x90, 60, 100]))
    expect(result).toEqual({ type: 'noteon', pitch: 60, velocity: 100 })
  })

  // ── 방어 ─────────────────────────────────────────────────────

  it('빈 배열 → null (방어)', () => {
    expect(parseMidiMessage([])).toBeNull()
  })
})
