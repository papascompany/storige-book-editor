/**
 * photo-items.ts — 사진인화(P2-d, 2026-10-19) 세션 `metadata.items` → 시트 매핑 `copies`/`label` 주입(순수 함수).
 *
 * 설계: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §3·§6.3, 계약 v1.25 ④. `buildSheetMap` 결과(SheetSpec[])의
 * 앞면 페이지(front.page)와 항목의 `canvasIndex` 가 같은 시트에만 `copies` 와 `label('사진 N')` 을 넣는다 —
 * 기존 `buildJobFiles`(partner-sessions.service)가 `SheetSpec.copies/label` 을 `files[].copies/label` 로 그대로 노출하므로
 * 워커·SheetSpec 타입은 바뀌지 않는다(v1.24 규약 재사용).
 *
 * 항목의 정제(불량 생략·copies 클램프·sizeCode 고정)는 `@storige/types` `readPhotoItems(input, profile.photoPrint)` 의 책임이며,
 * 여기서는 정제된 PhotoItem 만 받는다. kind 가 'photo-print' 가 아니거나 `metadata.items` 가 없으면 빈 배열 → 시트 무변경.
 */
import { readPhotoItems, resolvePhotoItemCount } from '@storige/types';
import type { PhotoItem, ProductProfile, SheetSpec } from '@storige/types';

/** 시트 라벨 — 항목 순번(0부터) + 1. `formatPhotoPageLabel` 의 '사진 N' 과 같은 번호 체계. */
export function formatPhotoSheetLabel(item: Pick<PhotoItem, 'index'>): string {
  return `사진 ${item.index + 1}`;
}

/**
 * 세션이 가질 수 있는 사진 항목 수 상한(보안 리뷰 security-1, 2026-10-19).
 * - `upload.maxPhotos`(프로파일 검증으로 1 이상 정수) 를 기본 상한으로 쓴다.
 * - `canvasCount`(세션 캔버스 수, resolveSessionPageCount) 가 1 이상이면 `resolvePhotoItemCount`(chemical N / digital ceil(N/2))
 *   와의 최솟값. 캔버스 수를 모르면(0·미지정) maxPhotos 만 적용한다.
 * - photoPrint 블록이 없으면(사진인화 아님) Infinity(호출부는 사진인화 세트에서만 자른다).
 */
export function resolvePhotoItemLimit(
  profile: Pick<ProductProfile, 'sheet' | 'photoPrint'>,
  canvasCount?: number,
): number {
  const maxPhotos: unknown = profile.photoPrint?.upload?.maxPhotos;
  let limit = typeof maxPhotos === 'number' && Number.isInteger(maxPhotos) && maxPhotos >= 1 ? maxPhotos : Infinity;
  if (typeof canvasCount === 'number' && Number.isInteger(canvasCount) && canvasCount >= 1) {
    limit = Math.min(limit, resolvePhotoItemCount(profile, canvasCount));
  }
  return limit;
}

/**
 * 세션 metadata 의 `items` 를 프로파일 기준으로 정제한다.
 * - 프로파일이 없거나 kind 가 'photo-print' 가 아니거나 `photoPrint` 블록이 없으면 [](NULL 세트·캘린더 세트 무변경).
 * - `metadata.items` 가 없으면 [].
 * - 항목 수는 `resolvePhotoItemLimit(profile, canvasCount)` 를 `readPhotoItems` 의 maxItems 로 넘겨 상한에서 끊는다(클라이언트가
 *   PATCH 로 넣은 과다 항목이 deliverables/sheet-map 에 그대로 실리지 않도록 — 캔버스 수(사진 수)·upload.maxPhotos 이하).
 */
export function readSessionPhotoItems(
  profile: Pick<ProductProfile, 'kind' | 'sheet' | 'photoPrint'> | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
  canvasCount?: number,
): PhotoItem[] {
  if (!profile || profile.kind !== 'photo-print' || !profile.photoPrint) return [];
  const raw = metadata?.items;
  if (raw === undefined || raw === null) return [];
  const limit = resolvePhotoItemLimit(profile, canvasCount);
  return readPhotoItems(raw, profile.photoPrint, Number.isFinite(limit) ? { maxItems: limit } : undefined);
}

/**
 * 시트 매핑에 항목의 매수·라벨을 주입한다.
 * - `items` 가 비면 입력 배열을 그대로 돌려준다.
 * - 시트 `front.page === item.canvasIndex` 인 항목만 반영(`copies`, `label`). 어느 시트에도 맞지 않는 항목은 무시한다.
 * - 같은 canvasIndex 가 여러 번 나오면 첫 항목을 쓴다(프로파일 정제본은 중복이 없다).
 * - `role: 'post-process'` 시트(업로드 후가공면)는 사진 시트가 아니므로 건드리지 않는다.
 * - 입력 시트 객체는 변경하지 않는다(주입된 시트만 새 객체).
 */
export function applyPhotoItemsToSheets(sheets: SheetSpec[], items: PhotoItem[]): SheetSpec[] {
  if (items.length === 0) return sheets;
  const byCanvas = new Map<number, PhotoItem>();
  for (const item of items) {
    if (!byCanvas.has(item.canvasIndex)) byCanvas.set(item.canvasIndex, item);
  }
  return sheets.map((sheet) => {
    if (sheet.role === 'post-process') return sheet;
    const item = byCanvas.get(sheet.front.page);
    if (!item) return sheet;
    return { ...sheet, copies: item.copies, label: formatPhotoSheetLabel(item) };
  });
}
