/**
 * Uint8Array를 브라우저 다운로드로 내보낸다.
 * jsdom 환경에서는 URL.createObjectURL을 스텁해 테스트.
 */
export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  // TypeScript 5.x requires ArrayBuffer-typed Uint8Array for BlobPart; cast is safe here
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a') as HTMLAnchorElement
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // click 직후 동기 revoke는 일부 브라우저에서 다운로드를 취소시키므로 한 틱 지연한다.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 텍스트 문자열을 UTF-8 Uint8Array로 인코딩해 downloadBytes에 전달한다. */
export function downloadText(text: string, filename: string, mime: string): void {
  downloadBytes(new TextEncoder().encode(text), filename, mime)
}

/** File(또는 Blob)을 ArrayBuffer로 비동기 읽기 */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}
