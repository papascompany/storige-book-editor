/**
 * photo-items.ts — 사진인화 세션 `metadata.items` → 시트 매핑 `copies`/`label` 주입(순수 함수).
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
import type { PhotoItem, PhotoJpegSpec, ProductProfile, SheetSpec } from '@storige/types';

/** 시트 라벨 — 항목 순번(0부터) + 1. `formatPhotoPageLabel` 의 '사진 N' 과 같은 번호 체계. */
export function formatPhotoSheetLabel(item: Pick<PhotoItem, 'index'>): string {
  return `사진 ${item.index + 1}`;
}

/**
 * 세션이 가질 수 있는 사진 항목 수 상한.
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

/** 사진 JPEG 기본 해상도(dpi) — 인화소 입고 표준. env PHOTO_JPEG_DPI 로 덮어쓴다(150~600). */
export const PHOTO_JPEG_DEFAULT_DPI = 300;
/** 사진 JPEG 기본 품질 — env PHOTO_JPEG_QUALITY 로 덮어쓴다(70~100). */
export const PHOTO_JPEG_DEFAULT_QUALITY = 95;

function readIntEnv(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function resolvePhotoJpegDpi(env: NodeJS.ProcessEnv = process.env): number {
  return readIntEnv(env.PHOTO_JPEG_DPI, PHOTO_JPEG_DEFAULT_DPI, 150, 600);
}

export function resolvePhotoJpegQuality(env: NodeJS.ProcessEnv = process.env): number {
  return readIntEnv(env.PHOTO_JPEG_QUALITY, PHOTO_JPEG_DEFAULT_QUALITY, 70, 100);
}

/** 사진인화 인화형(chemical) 세트인가 — 사진별 JPEG 출력 대상 */
export function isChemicalPhotoPrintProfile(
  profile: Pick<ProductProfile, 'kind' | 'photoPrint'> | null | undefined,
): boolean {
  return !!profile && profile.kind === 'photo-print' && profile.photoPrint?.process === 'chemical';
}

/** 파일 이름 조각 — 영숫자·하이픈만(그 밖은 '-'), 비면 'photo' */
function safeNamePart(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 32) : 'photo';
}

/**
 * 인화형 사진인화 세션 → 사진별 JPEG 명세(계약 v1.36).
 * - chemical 은 캔버스 1장 = 사진 1장(page i = 사진 i). pageCount 장 전부를 사진으로 낸다.
 * - 매수 = 같은 canvasIndex 항목의 copies, 항목이 없으면 프로파일 copies.min(최소 1).
 * - 파일 이름 = `photo_<NNN>_<sizeCode>_x<copies>.jpg`(NNN = 1부터, 최소 3자리). 정렬하면 사진 순서가 된다.
 * - chemical 이 아니거나 pageCount < 1 이면 [].
 */
export function buildPhotoJpegSpecs(
  profile: Pick<ProductProfile, 'kind' | 'photoPrint'> | null | undefined,
  items: PhotoItem[],
  pageCount: number,
): PhotoJpegSpec[] {
  if (!isChemicalPhotoPrintProfile(profile) || !Number.isInteger(pageCount) || pageCount < 1) return [];
  const photoPrint = profile!.photoPrint!;
  const minCopies = Math.max(1, Number.isInteger(photoPrint.copies?.min) ? photoPrint.copies.min : 1);
  const sizeCode = safeNamePart(photoPrint.sizes?.[0]?.code ?? 'photo');
  // v1.37: 인화 영역이 있으면 그 영역만 잘라 낸다(검증된 프로파일 값 그대로)
  const area = photoPrint.sizes?.[0]?.printAreaMm;
  const cropMm = area ? { left: area.left, top: area.top, width: area.width, height: area.height } : undefined;
  const width = Math.max(3, String(pageCount).length);
  const byCanvas = new Map<number, PhotoItem>();
  for (const item of items) {
    if (!byCanvas.has(item.canvasIndex)) byCanvas.set(item.canvasIndex, item);
  }
  const specs: PhotoJpegSpec[] = [];
  for (let page = 0; page < pageCount; page++) {
    const item = byCanvas.get(page);
    const copies = item && Number.isInteger(item.copies) && item.copies >= 1 ? item.copies : minCopies;
    const seq = String(page + 1).padStart(width, '0');
    specs.push({
      index: page,
      page,
      copies,
      label: formatPhotoSheetLabel({ index: page }),
      filename: `photo_${seq}_${sizeCode}_x${copies}.jpg`,
      ...(cropMm ? { cropMm } : {}),
    });
  }
  return specs;
}
