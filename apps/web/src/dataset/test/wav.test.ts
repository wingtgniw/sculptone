import { describe, it, expect } from 'vitest'
// 순수 함수 — AudioContext·DOM mock 없음
import { encodeWav } from '../wav'

// ── 페이크 AudioBuffer 헬퍼 ─────────────────────────────────────────────────
function mkFakeBuffer(channels: Float32Array[], sampleRate = 44100) {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    sampleRate,
    getChannelData: (ch: number) => channels[ch]!,
  }
}

// DataView 헬퍼: 리틀엔디언
function readU32LE(view: DataView, offset: number) {
  return view.getUint32(offset, true)
}
function readU16LE(view: DataView, offset: number) {
  return view.getUint16(offset, true)
}
function readI16LE(view: DataView, offset: number) {
  return view.getInt16(offset, true)
}

describe('encodeWav', () => {
  // ── 헤더 구조 검증 ───────────────────────────────────────────

  it('RIFF 시그니처가 오프셋 0에 있다', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // 'RIFF' = 0x52494646
    expect(view.getUint8(0)).toBe(0x52) // R
    expect(view.getUint8(1)).toBe(0x49) // I
    expect(view.getUint8(2)).toBe(0x46) // F
    expect(view.getUint8(3)).toBe(0x46) // F
  })

  it('WAVE 포맷 마커가 오프셋 8에 있다', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(view.getUint8(8)).toBe(0x57) // W
    expect(view.getUint8(9)).toBe(0x41) // A
    expect(view.getUint8(10)).toBe(0x56) // V
    expect(view.getUint8(11)).toBe(0x45) // E
  })

  it('fmt 서브청크 오프셋·크기 검증', () => {
    const buf = mkFakeBuffer([new Float32Array([0, 0]), new Float32Array([0, 0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // Subchunk1Size = 16 (offset 16)
    expect(readU32LE(view, 16)).toBe(16)
    // AudioFormat = 1 (PCM, offset 20)
    expect(readU16LE(view, 20)).toBe(1)
    // NumChannels = 2 (offset 22)
    expect(readU16LE(view, 22)).toBe(2)
  })

  it('SampleRate가 헤더에 올바르게 기록된다 (offset 24)', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readU32LE(view, 24)).toBe(44100)
  })

  it('ByteRate = SampleRate * NumChannels * BitsPerSample/8 (offset 28)', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // 44100 * 2 * 2 = 176400
    expect(readU32LE(view, 28)).toBe(44100 * 2 * 2)
  })

  it('BitsPerSample = 16 (offset 34)', () => {
    const buf = mkFakeBuffer([new Float32Array([0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readU16LE(view, 34)).toBe(16)
  })

  // ── 데이터 크기 검증 ─────────────────────────────────────────

  it('전체 출력 크기 = 44(header) + numSamples * 4(stereo 16bit)', () => {
    // 4샘플 스테레오
    const buf = mkFakeBuffer([
      new Float32Array([0, 0.5, -0.5, 1.0]),
      new Float32Array([0.25, -0.25, 0.75, -0.75]),
    ])
    const wav = encodeWav(buf, 44100)
    // 44 + 4 samples * 2 channels * 2 bytes = 44 + 16 = 60
    expect(wav.byteLength).toBe(44 + 4 * 2 * 2)
  })

  // ── Float32 → Int16 변환 검증 ────────────────────────────────

  it('1.0 → 32767 (최대값)', () => {
    const buf = mkFakeBuffer([new Float32Array([1.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // 44 = header end; offset 44 = 첫 샘플 (L0)
    expect(readI16LE(view, 44)).toBe(32767)
  })

  it('-1.0 → -32768 (최소값)', () => {
    const buf = mkFakeBuffer([new Float32Array([-1.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(-32768)
  })

  it('0.0 → 0', () => {
    const buf = mkFakeBuffer([new Float32Array([0.0]), new Float32Array([0.0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(0)
    expect(readI16LE(view, 46)).toBe(0)
  })

  // ── 스테레오 인터리빙 검증 ───────────────────────────────────

  it('인터리빙: [L0, R0, L1, R1, ...] 순서', () => {
    const buf = mkFakeBuffer([
      new Float32Array([1.0, 0.0]), // L0=1.0, L1=0.0
      new Float32Array([0.0, 1.0]), // R0=0.0, R1=1.0
    ])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    // offset 44: L0 = 32767
    expect(readI16LE(view, 44)).toBe(32767) // L0
    // offset 46: R0 = 0
    expect(readI16LE(view, 46)).toBe(0) // R0
    // offset 48: L1 = 0
    expect(readI16LE(view, 48)).toBe(0) // L1
    // offset 50: R1 = 32767
    expect(readI16LE(view, 50)).toBe(32767) // R1
  })

  // ── 클램핑 ──────────────────────────────────────────────────

  it('2.0(over) → 32767 (클램핑)', () => {
    const buf = mkFakeBuffer([new Float32Array([2.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(32767)
  })

  it('-2.0(under) → -32768 (클램핑)', () => {
    const buf = mkFakeBuffer([new Float32Array([-2.0]), new Float32Array([0])])
    const wav = encodeWav(buf, 44100)
    const view = new DataView(wav.buffer)
    expect(readI16LE(view, 44)).toBe(-32768)
  })
})
