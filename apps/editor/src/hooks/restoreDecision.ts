/**
 * 자동저장 복원 제안 판정 — 의존성 없는 순수 로직 (단위테스트 격리용).
 *
 * useEmbedAutoSave 에서 import 해 쓴다. 캔버스/fabric/스토어에 의존하지 않으므로
 * happy-dom 2D 컨텍스트 없이도 테스트 가능하다.
 */

/**
 * 로컬 백업 페이로드 형태 (saveToLocal / 언마운트 cleanup 이 쓰는 동일 스키마).
 */
export interface EmbedLocalBackup {
  sessionId: string
  /** collectCanvasData() 결과 — 멀티페이지면 배열, 단일이면 객체 */
  canvasData: unknown
  /** ISO 8601 — 백업이 만들어진 시각(클라이언트 시계) */
  savedAt: string
}

/**
 * 복원 제안 판정에 필요한 서버 세션의 최소 형태.
 */
export interface RestoreSessionInfo {
  id: string
  /** 서버가 마지막으로 세션을 저장한 시각(ISO 8601). 신뢰 비교 기준. */
  updatedAt?: string | null
  /**
   * 서버에 저장된 canvasData (선택 — additive, 미전달 시 종전 시각 비교만 수행).
   * 전달되면 백업과의 경량 동등성 비교(페이지 수 + 페이지별 objects 개수)로
   * "실질 동일 내용" 백업의 복원 제안을 억제한다 — 무편집 unmount 백업 재작성이
   * backup.savedAt > session.updatedAt 을 상시 성립시켜 재진입마다 배너가 뜨던
   * footgun 방어(R4).
   */
  canvasData?: unknown
}

/**
 * 복원 제안 판정 결과.
 * - offer=false: 백업 없음/세션 불일치/데이터 없음 → 모달 미노출(무동작).
 * - offer=true + confident=true: 백업 savedAt > 서버 updatedAt 이 명확 → "이 기기에 저장
 *   안 된 변경" 문구.
 * - offer=true + confident=false: 시각 비교 불가/모호(파싱 실패·동률) → 안전측 노출하되
 *   "서버보다 최신이 아닐 수 있음" 문구. 어느 경우든 사용자가 [복원] 누르기 전엔 캔버스 불변.
 */
export interface RestoreDecision {
  offer: boolean
  confident: boolean
  /** offer=true 일 때 백업 시각(배너 "N분 전" 표시용) */
  backupAt?: Date
}

/** 페이지 1장의 경량 지표 — fabric JSON 이면 objects 개수(없으면 0), 형태 미상이면 null. */
function pageObjectCount(page: unknown): number | null {
  if (page !== null && typeof page === 'object') {
    const objects = (page as { objects?: unknown }).objects
    return Array.isArray(objects) ? objects.length : 0
  }
  return null
}

/**
 * canvasData 의 경량 시그니처 — 페이지별 objects 개수 배열.
 * 단일(객체) 데이터는 1페이지로 취급. 형태를 알 수 없으면 null(비교 불가 → 억제하지 않음).
 * 저비용 판정용이라 객체 내용까지는 비교하지 않는다(페이지 수 + 개수 동일 = 동일 취급).
 */
export function canvasDataSignature(data: unknown): number[] | null {
  if (data == null) return null
  if (Array.isArray(data)) {
    if (data.length === 0) return null
    const sig: number[] = []
    for (const page of data) {
      const count = pageObjectCount(page)
      if (count === null) return null
      sig.push(count)
    }
    return sig
  }
  const count = pageObjectCount(data)
  return count === null ? null : [count]
}

/**
 * 자동저장 복원 제안 여부를 판정하는 **순수 함수**(데이터 유실 footgun 방어의 핵심).
 *
 * 자동 복원은 절대 하지 않는다 — 이 함수는 "사용자에게 물어볼지" 만 결정하고,
 * 실제 캔버스 변경(loadFromJSON)은 사용자가 [복원] 을 누른 뒤에만 일어난다.
 *
 * 판정 규칙:
 *  1. 백업이 없거나 canvasData 가 비면 → offer:false (무동작).
 *  2. 백업 sessionId 가 현재 세션과 다르면 → offer:false (남의 세션 백업 무시).
 *  3. 시각 비교:
 *     - 두 시각 모두 유효하고 backup.savedAt > session.updatedAt → offer:true, confident:true.
 *     - backup.savedAt <= session.updatedAt(서버가 더 최신/동시각) → offer:false.
 *       (서버가 백업을 이미 반영했거나 더 최신 = 복원 제안은 오히려 후퇴 위험.)
 *     - 한쪽이라도 시각이 유효하지 않으면(서버 updatedAt 부재, savedAt 파싱 실패 등)
 *       → 안전측으로 offer:true, confident:false. 단 캔버스는 불변(사용자 선택 대기).
 */
export function shouldOfferRestore(
  backup: EmbedLocalBackup | null | undefined,
  session: RestoreSessionInfo | null | undefined,
): RestoreDecision {
  if (!backup || backup.canvasData == null) return { offer: false, confident: false }

  // 멀티페이지 빈 배열도 데이터 없음으로 취급
  if (Array.isArray(backup.canvasData) && backup.canvasData.length === 0) {
    return { offer: false, confident: false }
  }

  // 세션 식별자 일치 검증 (남의 세션 백업 방어)
  if (!session || !session.id || backup.sessionId !== session.id) {
    return { offer: false, confident: false }
  }

  // R4 — 경량 동등성 억제: 서버 canvasData 가 전달됐고 백업과 페이지 수·페이지별 objects
  // 개수가 전부 동일하면, 백업은 무편집 unmount 재작성일 가능성이 높다 → 제안하지 않는다.
  // 시그니처를 만들 수 없으면(형태 미상) 억제하지 않고 종전 시각 비교로 폴백(안전측).
  if (session.canvasData !== undefined) {
    const backupSig = canvasDataSignature(backup.canvasData)
    const serverSig = canvasDataSignature(session.canvasData)
    if (
      backupSig !== null &&
      serverSig !== null &&
      backupSig.length === serverSig.length &&
      backupSig.every((count, i) => count === serverSig[i])
    ) {
      return { offer: false, confident: false }
    }
  }

  const backupMs = Date.parse(backup.savedAt)
  const serverMs = session.updatedAt ? Date.parse(session.updatedAt) : NaN
  const backupValid = Number.isFinite(backupMs)
  const serverValid = Number.isFinite(serverMs)
  const backupAt = backupValid ? new Date(backupMs) : undefined

  // 둘 다 유효 → 명확 비교
  if (backupValid && serverValid) {
    if (backupMs > serverMs) {
      return { offer: true, confident: true, backupAt }
    }
    // 서버가 더 최신이거나 동시각 → 백업이 이미 반영됐거나 후퇴 위험: 제안 안 함
    return { offer: false, confident: false }
  }

  // 시각 비교 불가/모호 → 안전측 노출(확신 없음). 백업 자체가 유효하면 시각 미상이라도 보여준다.
  if (backupValid) {
    return { offer: true, confident: false, backupAt }
  }

  // 백업 시각조차 파싱 불가 — 데이터는 있으나 시점 미상. 안전측 노출(시각 없이).
  return { offer: true, confident: false }
}
