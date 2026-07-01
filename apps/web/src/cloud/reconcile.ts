/**
 * 로컬 ↔ 클라우드 프로젝트 목록을 비교해 Last-Write-Wins 동기화 결정을 반환한다.
 *
 * 순수 함수 — 외부 부작용 없음, 입력 배열 불변.
 * updatedAt은 epoch 밀리초로 파싱해 비교한다(포맷 불일치 방어: ISO 8601 Z/오프셋 혼용 허용).
 * 파싱 불가(NaN) 방어: 한쪽만 유효하면 유효한 쪽 방향, 둘 다 NaN이면 skip(안전).
 */

export interface ProjectMeta {
  id: string
  updatedAt: string // ISO 8601 (UTC Z 또는 오프셋 표기 모두 허용)
}

export interface ReconcileResult {
  toUpload: string[] // local → cloud: 로컬에만 있거나 로컬이 최신
  toDownload: string[] // cloud → local: 클라우드에만 있거나 클라우드가 최신
}

/** ISO 8601 문자열 → epoch ms. 파싱 불가면 NaN. */
function parseEpoch(ts: string): number {
  return Date.parse(ts)
}

export function reconcile(local: ProjectMeta[], cloud: ProjectMeta[]): ReconcileResult {
  const localMap = new Map<string, string>(local.map((p) => [p.id, p.updatedAt]))
  const cloudMap = new Map<string, string>(cloud.map((p) => [p.id, p.updatedAt]))

  const toUpload: string[] = []
  const toDownload: string[] = []

  // 로컬 기준: 로컬에만 있거나 로컬이 더 최신이면 upload
  for (const [id, localAt] of localMap) {
    const cloudAt = cloudMap.get(id)
    if (cloudAt === undefined) {
      // 로컬에만 존재 → upload
      toUpload.push(id)
    } else {
      const lEpoch = parseEpoch(localAt)
      const cEpoch = parseEpoch(cloudAt)
      if (isNaN(lEpoch) && isNaN(cEpoch)) {
        // 둘 다 파싱 불가 → skip(안전)
      } else if (isNaN(cEpoch)) {
        // 로컬만 유효 → upload
        toUpload.push(id)
      } else if (!isNaN(lEpoch) && lEpoch > cEpoch) {
        // 로컬 최신 → upload
        toUpload.push(id)
      }
      // lEpoch === cEpoch: tie → 아무것도 안 함
      // lEpoch < cEpoch: 클라우드 최신 → 아래 루프에서 처리
      // isNaN(lEpoch) && !isNaN(cEpoch): 클라우드만 유효 → 아래 루프에서 처리
    }
  }

  // 클라우드 기준: 클라우드에만 있거나 클라우드가 더 최신이면 download
  for (const [id, cloudAt] of cloudMap) {
    const localAt = localMap.get(id)
    if (localAt === undefined) {
      // 클라우드에만 존재 → download
      toDownload.push(id)
    } else {
      const lEpoch = parseEpoch(localAt)
      const cEpoch = parseEpoch(cloudAt)
      if (isNaN(lEpoch) && isNaN(cEpoch)) {
        // 둘 다 파싱 불가 → skip(안전)
      } else if (isNaN(lEpoch)) {
        // 클라우드만 유효 → download
        toDownload.push(id)
      } else if (!isNaN(cEpoch) && cEpoch > lEpoch) {
        // 클라우드 최신 → download
        toDownload.push(id)
      }
      // cEpoch === lEpoch: tie → 아무것도 안 함
      // cEpoch < lEpoch: 로컬 최신 → 위 루프에서 처리됨
      // isNaN(cEpoch) && !isNaN(lEpoch): 로컬만 유효 → 위 루프에서 처리됨
    }
  }

  return { toUpload, toDownload }
}
