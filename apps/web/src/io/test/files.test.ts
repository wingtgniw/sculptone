import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { downloadBytes, downloadText, readFileAsArrayBuffer } from '../files'

describe('files', () => {
  // jsdom does not implement URL.createObjectURL / revokeObjectURL;
  // stub them so vi.spyOn can replace them in individual tests.
  beforeAll(() => {
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      })
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('readFileAsArrayBuffer', () => {
    it('File의 내용을 ArrayBuffer로 반환한다', async () => {
      const content = new Uint8Array([1, 2, 3, 4])
      const file = new File([content], 'test.mid', { type: 'audio/midi' })
      const buf = await readFileAsArrayBuffer(file)
      expect(buf).toBeInstanceOf(ArrayBuffer)
      expect(new Uint8Array(buf)).toEqual(content)
    })

    it('FileReader 오류 시 promise가 reject된다', async () => {
      const err = new DOMException('read error', 'NotReadableError')
      const mockReaderState: {
        error: DOMException
        onerror: null | (() => void)
        readAsArrayBuffer: (file: Blob) => void
      } = {
        error: err,
        onerror: null,
        readAsArrayBuffer(_file: Blob) {
          // onload/onerror 할당 후 비동기로 onerror 호출
          queueMicrotask(() => mockReaderState.onerror?.())
        },
      }
      vi.stubGlobal('FileReader', function () {
        return mockReaderState
      })
      try {
        const file = new File([], 'bad.mid')
        await expect(readFileAsArrayBuffer(file)).rejects.toBe(err)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('downloadBytes', () => {
    it('createObjectURL · createElement · appendChild · click · remove · 지연 revoke를 호출한다', () => {
      vi.useFakeTimers()
      // jsdom은 URL.createObjectURL을 지원하지 않으므로 스텁
      const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
      const revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
      const createElement = vi
        .spyOn(document, 'createElement')
        .mockReturnValue(anchor as unknown as HTMLElement)
      const appendChild = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation((n) => n as Node)

      downloadBytes(new Uint8Array([0, 1]), 'out.mid', 'audio/midi')

      expect(createURL).toHaveBeenCalledOnce()
      expect(createElement).toHaveBeenCalledWith('a')
      expect(appendChild).toHaveBeenCalledWith(anchor)
      expect(anchor.download).toBe('out.mid')
      expect(anchor.click).toHaveBeenCalledOnce()
      expect(anchor.remove).toHaveBeenCalledOnce()
      // revoke는 동기 호출이 아니라 setTimeout(0) 이후에 일어나야 한다
      expect(revokeURL).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(revokeURL).toHaveBeenCalledWith('blob:mock')
    })
  })

  describe('downloadText', () => {
    it('텍스트를 Uint8Array로 인코딩해 downloadBytes를 호출한다', () => {
      const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
      vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLElement)
      vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n as Node)

      downloadText('{"hello":"world"}', 'out.json', 'application/json')

      expect(createURL).toHaveBeenCalledOnce()
      expect(anchor.download).toBe('out.json')
    })
  })
})
