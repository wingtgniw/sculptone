import { describe, it, expect } from 'vitest'
// 순수 함수 — mock 없음
import { parseShareToken } from '../parseShareToken'

describe('parseShareToken — 순수 URL 파서', () => {
  // ── 정상 케이스 ───────────────────────────────────────────────

  it('?share=abc123 → "abc123" 반환', () => {
    expect(parseShareToken('https://app.sculptone.com?share=abc123')).toBe('abc123')
  })

  it('여러 파라미터 중 share 포함 → share 값만 반환', () => {
    expect(parseShareToken('https://app.sculptone.com?foo=bar&share=tok42&baz=qux')).toBe('tok42')
  })

  it('share 파라미터가 뒤에 있어도 추출됨', () => {
    expect(parseShareToken('https://app.sculptone.com?other=value&share=mytoken')).toBe('mytoken')
  })

  it('URL에 hash가 있어도 share 파라미터 정상 추출', () => {
    expect(parseShareToken('https://app.sculptone.com?share=hashtest#section')).toBe('hashtest')
  })

  it('32자 hex 형식 토큰 → 정상 반환', () => {
    const hexToken = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
    expect(parseShareToken(`https://app.sculptone.com?share=${hexToken}`)).toBe(hexToken)
  })

  // ── null 반환 케이스 ──────────────────────────────────────────

  it('share 파라미터 없음 → null', () => {
    expect(parseShareToken('https://app.sculptone.com')).toBeNull()
  })

  it('?share= 빈 문자열 → null', () => {
    expect(parseShareToken('https://app.sculptone.com?share=')).toBeNull()
  })

  it('다른 파라미터만 있음 → null', () => {
    expect(parseShareToken('https://app.sculptone.com?foo=bar&baz=qux')).toBeNull()
  })

  it('잘못된 URL 문자열 → null (예외 삼킴)', () => {
    expect(parseShareToken('not-a-valid-url')).toBeNull()
  })

  it('빈 문자열 → null', () => {
    expect(parseShareToken('')).toBeNull()
  })
})
