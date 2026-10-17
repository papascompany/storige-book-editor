/**
 * 편집 세션의 페이지 수 산출(2026-10-16, 낱장 N장 duplex-split 결함 수정).
 *
 * 배경: createDuplexSplitJob 은 `metadata.pages.length` 를 읽었으나 편집기는 세션 생성 시
 * metadata.pages 를 호스트 pageCount **숫자**로 보낸다(apps/editor/src/embed.tsx createPayload).
 * 숫자에 .length → undefined → ODD_PAGE_COUNT, pages 미전달이면 EMPTY_SESSION_PAGES 로
 * duplex-split 이 편집기 세션에서 성립한 적이 없었다.
 *
 * 이 모듈은 세션에 기록된 값만으로 페이지 수를 정한다(추론 금지). 우선순위는 아래 주석.
 * 워커(handleDuplexSplitSynthesis)가 실제 PDF 페이지 수와 기대치 일치를 다시 검증하므로
 * API 는 기대치만 산출한다.
 */
import type { EditSessionEntity } from './entities/edit-session.entity';

export function resolveSessionPageCount(
  session: Pick<EditSessionEntity, 'metadata' | 'canvasData'>,
): number {
  const canvasData: unknown = session.canvasData;
  const metadataPages: unknown = session.metadata?.pages;

  // ① 다캔버스 배열 = 편집기 완료 시 저장한 캔버스 목록. 낱장 N장은 캔버스 1개 = PDF 1페이지.
  if (Array.isArray(canvasData)) return canvasData.length;

  // ② 세션 생성 시 호스트가 보낸 pageCount(숫자). 양의 정수만 인정.
  if (
    typeof metadataPages === 'number' &&
    Number.isInteger(metadataPages) &&
    metadataPages > 0
  ) {
    return metadataPages;
  }

  // ③ split 경로 계약의 페이지 객체 배열(metadata.pages[].sortOrder).
  if (Array.isArray(metadataPages)) return metadataPages.length;

  // ④ legacy: canvasData.pages 배열(구 저장 형식).
  const legacyPages: unknown = (canvasData as { pages?: unknown } | null)?.pages;
  if (Array.isArray(legacyPages)) return legacyPages.length;

  // ⑤ 단일 fabric JSON({objects:[...]}) = 캔버스 1개.
  if (
    canvasData !== null &&
    typeof canvasData === 'object' &&
    Array.isArray((canvasData as { objects?: unknown }).objects)
  ) {
    return 1;
  }

  // ⑥ 근거 없음.
  return 0;
}
