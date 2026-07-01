/**
 * URL 문자열에서 ?share=<token> 쿼리 파라미터를 추출한다.
 *
 * 순수 함수 — window.location에 직접 접근하지 않음.
 * 빈 문자열, 없는 파라미터, 잘못된 URL → null 반환.
 *
 * 호출자: useShareLoader가 window.location.href를 전달.
 * 테스트: parseShareToken.test.ts (완전 TDD, mock 없음).
 */
export function parseShareToken(url: string): string | null {
  try {
    const parsed = new URL(url)
    const token = parsed.searchParams.get('share')
    return token && token.length > 0 ? token : null
  } catch {
    return null
  }
}
