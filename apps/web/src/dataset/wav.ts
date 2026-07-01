/**
 * AudioBuffer-like 인터페이스 → 16-bit PCM WAV (RIFF).
 *
 * 순수 함수 — AudioContext / DOM 의존 없음.
 * 테스트는 페이크 buffer 객체(numberOfChannels/length/getChannelData)로 직접 검증.
 *
 * RIFF WAV 헤더 (44 bytes):
 *   [0 ] 'RIFF' (4)  ChunkSize (4 LE)  'WAVE' (4)
 *   [12] 'fmt ' (4)  16 (4 LE)  AudioFormat=1 (2 LE)  NumChannels=2 (2 LE)
 *   [24] SampleRate (4 LE)  ByteRate=SR*4 (4 LE)  BlockAlign=4 (2 LE)  BitsPerSample=16 (2 LE)
 *   [36] 'data' (4)  DataSize (4 LE)
 *   [44] interleaved 16-bit LE PCM samples [L0,R0,L1,R1,...]
 *
 * Float32 → Int16 변환:
 *   Math.max(-32768, Math.min(32767, Math.round(s * 32768)))
 *   −1.0 → −32768, +1.0 → +32767 (클램프 포함)
 */
export function encodeWav(
  buffer: {
    numberOfChannels: number
    length: number
    getChannelData(channel: number): Float32Array
  },
  sampleRate: number,
): Uint8Array {
  const numChannels = 2 // 항상 스테레오 출력
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = buffer.length * blockAlign
  const totalSize = 44 + dataSize

  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  // ── 채널 데이터 획득 (모노 입력 → 스테레오 업믹스) ──────────────
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels >= 2 ? buffer.getChannelData(1) : left // 모노 → 두 채널에 동일 데이터

  // ── RIFF 청크 ──────────────────────────────────────────────────
  out[0] = 0x52
  out[1] = 0x49
  out[2] = 0x46
  out[3] = 0x46 // 'RIFF'
  view.setUint32(4, 36 + dataSize, true) // ChunkSize
  out[8] = 0x57
  out[9] = 0x41
  out[10] = 0x56
  out[11] = 0x45 // 'WAVE'

  // ── fmt 서브청크 ───────────────────────────────────────────────
  out[12] = 0x66
  out[13] = 0x6d
  out[14] = 0x74
  out[15] = 0x20 // 'fmt '
  view.setUint32(16, 16, true) // Subchunk1Size
  view.setUint16(20, 1, true) // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true) // NumChannels
  view.setUint32(24, sampleRate, true) // SampleRate
  view.setUint32(28, byteRate, true) // ByteRate
  view.setUint16(32, blockAlign, true) // BlockAlign
  view.setUint16(34, bitsPerSample, true) // BitsPerSample

  // ── data 서브청크 ──────────────────────────────────────────────
  out[36] = 0x64
  out[37] = 0x61
  out[38] = 0x74
  out[39] = 0x61 // 'data'
  view.setUint32(40, dataSize, true) // Subchunk2Size

  // ── 인터리빙: [L0, R0, L1, R1, ...] ───────────────────────────
  // 변환: Math.max(-32768, Math.min(32767, Math.round(s * 32768)))
  // −1.0 → −32768, +1.0 → +32767
  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    const lSample = Math.max(-32768, Math.min(32767, Math.round(left[i]! * 32768)))
    const rSample = Math.max(-32768, Math.min(32767, Math.round(right[i]! * 32768)))
    view.setInt16(offset, lSample, true)
    view.setInt16(offset + 2, rSample, true)
    offset += 4
  }

  return out
}
