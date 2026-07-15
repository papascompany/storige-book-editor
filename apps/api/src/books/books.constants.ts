/**
 * Partner API v1 — Books 도메인 상수/타입 (Stage 3).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.4~2.6·§6.1
 */

/** uid 접두 체계 (설계서 §2.0) — 내부 UUID(id)는 외부 비노출, uid 만 노출 */
export const BOOK_UID_PREFIX = 'bk_';
export const BOOK_FINALIZATION_UID_PREFIX = 'fin_';

/**
 * 직접(멀티파트) 업로드 상한 — 100MB 단일.
 *
 * ⚠️ 설계서 "90/100MB" 표기 정정: 코드상 90MB 임계는 부재 → 100MB 단일 임계로
 *    확정한다. 초과분은 presigned/multipart 동결 표면(≤2GB)으로 업로드 후
 *    fileId 참조 투입 경로를 쓴다(§1.4). 100MB 는 기존 files 업로드 라우트
 *    (files.controller upload/external)·STORAGE_MAX_FILE_SIZE 기본과 정합.
 */
export const BOOK_ASSET_DIRECT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/**
 * book 당 active photo 자산 상한 — 무제한 누적 방어(적대 리뷰 렌즈1 P2-2).
 * 포토북 최대 페이지 규모를 넉넉히 상회하는 방어캡. 초과 시 422 ERR_VALIDATION_FAILED.
 */
export const BOOK_MAX_ACTIVE_PHOTOS = 500;

/**
 * 직접 업로드 허용 MIME — 기존 files.uploadFile(PDF-only) 계약 승계(AD-1: files.service 무접촉).
 * 이미지/대용량 자산(photo 등)은 동결 업로드 표면으로 올린 fileId 참조 경로를 쓴다.
 */
export const BOOK_ASSET_DIRECT_UPLOAD_MIME: readonly string[] = ['application/pdf'];

/** 생성 유형 4종 (설계서 §2.4·§6.1) */
export type BookCreationType =
  | 'PDF_UPLOAD'
  | 'TEMPLATE'
  | 'MIX_COVER_TEMPLATE'
  | 'EDITOR_SESSION';

export const BOOK_CREATION_TYPES: readonly BookCreationType[] = [
  'PDF_UPLOAD',
  'TEMPLATE',
  'MIX_COVER_TEMPLATE',
  'EDITOR_SESSION',
];

/** 도서 상태 2종 (설계서 §6.2 AD-3) */
export type BookStatus = 'DRAFT' | 'FINALIZED';
export const BOOK_STATUSES: readonly BookStatus[] = ['DRAFT', 'FINALIZED'];

/** 자산 유형 5종 (설계서 §2.5) */
export type BookAssetType =
  | 'pdf_cover'
  | 'pdf_contents'
  | 'photo'
  | 'cover_binding'
  | 'contents_binding';

export const BOOK_ASSET_TYPES: readonly BookAssetType[] = [
  'pdf_cover',
  'pdf_contents',
  'photo',
  'cover_binding',
  'contents_binding',
];

/** 자산 상태 — active(현행) / replaced(교체 이력 보존) */
export type BookAssetStatus = 'active' | 'replaced';

/** 최종화 실행 상태머신 (설계서 §6.3) — 상태만 본 배치에서 신설, 오케스트레이션은 W3 */
export type BookFinalizationStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'COMPOSING'
  | 'COMPLETED'
  | 'FAILED';

export const BOOK_FINALIZATION_STATUSES: readonly BookFinalizationStatus[] = [
  'PENDING',
  'VALIDATING',
  'COMPOSING',
  'COMPLETED',
  'FAILED',
];

/**
 * creationType × asset_type 호환 매트릭스 (설계서 §6.1 — ERR_ASSET_INCOMPATIBLE 판정 기준).
 *
 * | creationType       | pdf_cover | pdf_contents | photo | cover_binding | contents_binding |
 * | PDF_UPLOAD         |    ✅     |     ✅       |  ✖   |      ✖       |       ✖         |
 * | TEMPLATE           |    ✖     |     ✖       |  ✅   |      ✅       |       ✅         |
 * | MIX_COVER_TEMPLATE |    ✖     |     ✅       |  ✅   |      ✅       |       ✖         |
 * | EDITOR_SESSION     | 세션 산출 자동 연결 — 수동 투입 전부 ✖                            |
 */
export const BOOK_ASSET_COMPATIBILITY: Record<
  BookCreationType,
  ReadonlySet<BookAssetType>
> = {
  PDF_UPLOAD: new Set<BookAssetType>(['pdf_cover', 'pdf_contents']),
  TEMPLATE: new Set<BookAssetType>([
    'photo',
    'cover_binding',
    'contents_binding',
  ]),
  MIX_COVER_TEMPLATE: new Set<BookAssetType>([
    'pdf_contents',
    'photo',
    'cover_binding',
  ]),
  EDITOR_SESSION: new Set<BookAssetType>([]),
};

/** creationType 이 assetType 을 수동 투입 가능한가 (매트릭스 조회) */
export function isAssetCompatible(
  creationType: BookCreationType,
  assetType: BookAssetType,
): boolean {
  return BOOK_ASSET_COMPATIBILITY[creationType].has(assetType);
}
