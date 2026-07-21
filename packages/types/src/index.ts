/**
 * @storige/types
 * Shared TypeScript types for Storige system
 */

// 책등(세네카) 계산 순수 엔진 (R-44) — API·워커·표지 파생 공용 단일 산식
export * from './spine-calc';

// ============================================================================
// User & Authentication
// ============================================================================

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  // P1 멀티테넌시 (2026-06-17): 사이트 운영자 역할. 전역(SUPER_ADMIN/ADMIN)과 달리
  // user_site_roles 에 매핑된 site 에서만 권한을 가진다(TenantGuard 가 스코핑 강제).
  // SITE_ADMIN = 해당 site 의 관리자(템플릿·라이브러리·상품·주문 관리),
  // SITE_MANAGER = 해당 site 의 운영(주문/세션 조회·상태변경 등 제한).
  SITE_ADMIN = 'SITE_ADMIN',
  SITE_MANAGER = 'SITE_MANAGER',
  MANAGER = 'MANAGER',
  CUSTOMER = 'CUSTOMER',
}

/**
 * P1 멀티테넌시 — JWT 에 실리는 사이트별 역할 클레임.
 * 한 계정이 여러 site 를 다른 역할로 운영할 수 있다(user_site_roles 1:N).
 * 전역 관리자(SUPER_ADMIN/ADMIN)는 siteRoles 가 비어 있어도 전역 접근(dual-mode).
 */
export interface SiteRoleClaim {
  siteId: string;
  siteName?: string;
  role: UserRole; // SITE_ADMIN | SITE_MANAGER (해당 site 에서의 역할)
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  /**
   * P1 멀티테넌시 (2026-06-17) — 이 계정이 운영하는 사이트별 역할 목록.
   * 전역 관리자(SUPER_ADMIN/ADMIN/MANAGER)는 비어 있을 수 있다(dual-mode).
   * GET /auth/me 가 채워서 반환(additive optional — 하위호환).
   */
  siteRoles?: SiteRoleClaim[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ============================================================================
// Category
// ============================================================================

export interface Category {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  level: 1 | 2 | 3;
  sortOrder: number;
  children?: Category[];
  createdAt: Date;
}

// ============================================================================
// Template
// ============================================================================

/**
 * 템플릿 타입
 * - wing: 날개 (표지를 접었을 때 안쪽으로 접히는 부분)
 * - cover: 표지 (앞/뒤 표지, 위치로 구분)
 * - spine: 책등 (책의 등 부분)
 * - page: 내지 (본문 페이지)
 */
export enum TemplateType {
  WING = 'wing',
  COVER = 'cover',
  SPINE = 'spine',
  PAGE = 'page',
  SPREAD = 'spread',
  /** 면지 (앞면지/뒷면지) — 인쇄 워크플로우 v1 Phase 2 (2026-05-19) */
  ENDPAPER = 'endpaper',
}

/**
 * 템플릿셋 타입
 * - book: 책자 (날개 + 앞표지 + 책등 + 내지 N장 + 뒤표지 + 날개)
 * - leaflet: 리플렛 (앞표지 + 내지 N장 + 뒤표지)
 * - photobook: 포토북 (펼침면 표지/내지 + 사진틀 중심, editorMode='book' 스프레드)
 */
export enum TemplateSetType {
  BOOK = 'book',
  LEAFLET = 'leaflet',
  PHOTOBOOK = 'photobook',
}

/**
 * 템플릿
 * 단면 1페이지에 해당하는 디자인 틀
 */
export interface Template {
  id: string;
  name: string;
  thumbnailUrl?: string;
  type: TemplateType;
  width: number;              // 판형 (mm)
  height: number;             // 판형 (mm)
  editable: boolean;          // 편집 가능 여부
  deleteable: boolean;        // 삭제 가능 여부
  canvasData: CanvasData;     // Fabric.js JSON
  spreadConfig?: SpreadConfig | null; // spread 타입일 때만 사용
  isDeleted: boolean;         // 소프트 삭제
  // Legacy fields (하위 호환)
  categoryId?: string;
  editCode?: string;
  templateCode?: string;
  isActive?: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 템플릿 생성 입력
 */
export interface CreateTemplateInput {
  name: string;
  thumbnailUrl?: string;
  type: TemplateType;
  width: number;
  height: number;
  editable?: boolean;
  deleteable?: boolean;
  canvasData?: CanvasData;
  categoryId?: string;
}

/**
 * 템플릿 수정 입력
 */
export interface UpdateTemplateInput {
  name?: string;
  thumbnailUrl?: string;
  type?: TemplateType;
  width?: number;
  height?: number;
  editable?: boolean;
  deleteable?: boolean;
  canvasData?: CanvasData;
}

/**
 * 템플릿 참조 (템플릿셋 내 템플릿 구성)
 */
export interface TemplateRef {
  templateId: string;
  required: boolean;          // 필수 페이지 여부
}

/**
 * 템플릿셋
 * 템플릿들의 조합. 상품에 연결되어 에디터의 기본 구성을 정의
 */
/**
 * 면지(EndPaper) 구성 — 인쇄 워크플로우 v1 Phase 2 (2026-05-19).
 *
 * 책의 표지 안쪽(앞)과 뒤표지 안쪽(뒷)에 위치하는 빈 면지.
 * 관리자가 0~6 장 범위에서 사전 등록하고, 각 면지의 편집 가능 여부를 결정.
 */
export interface EndpaperConfig {
  /** 앞면지 개수 (0~6). 0이면 면지 없음 */
  frontCount: number;
  /** 뒷면지 개수 (0~6). 0이면 면지 없음 */
  backCount: number;
  /** 앞면지 편집 가능 여부 (false 면 readonly, 인쇄용 빈 페이지만) */
  frontEditable: boolean;
  /** 뒷면지 편집 가능 여부 */
  backEditable: boolean;
}

/**
 * PHOTOBOOK 페이지 가변 가격 메타 — Phase 2 (2026-06-24).
 *
 * storige 는 가격을 계산하지 않는다. 관리자가 템플릿셋에 이 메타를 저장하면,
 * 편집기는 완료 시 현재 총 pageCount 와 함께 emit 하고 **파트너 장바구니가 가격을 계산**한다.
 * (설계 §3-4·§8 — 가격 계산 주체=파트너)
 */
export interface PhotobookPricing {
  /** 기본 포함 페이지 (예: 16). 이 수까지는 추가 단가 없음 */
  includedPages: number;
  /** 최소 제작 페이지 (이하로는 삭제 차단 — 가드용 메타) */
  minPages: number;
  /** 증감 단위 (펼침면=2 등) */
  pageStep: number;
  /** 초과 페이지당 단가 (정수/소수). 통화·세금은 파트너 책임 */
  perPageUnit: number;
}

// ============================================================================
// 커버 체계 (D-4, 2026-07-06) — 공통 3종 + 확장형 코드 모델
// ============================================================================

/**
 * 커버 종류 시드 코드 3종 (D-4). ⚠️ **고정 enum 아님** — 커버 종류는 상품 구성에 따라
 * 추가될 수 있으므로 저장/전송은 자유 문자열(varchar) 코드로 하고, 이 상수는 기본 시드일 뿐이다.
 * - 'hardcover_wrap'            : 하드커버(싸바리) — caseBind geometry 로 출력 사이즈 확장
 * - 'softcover_variable_spine'  : 책등가변 일반커버(소프트커버) — 현행 SpreadSpec 경로
 * - 'ready_made'                : 기성커버 — coverEditable=false + coverPreviewImage 경로
 */
export const COVER_TYPE_SEED_CODES = [
  'hardcover_wrap',
  'softcover_variable_spine',
  'ready_made',
] as const;

/**
 * 싸바리(하드커버 보드 wrap) geometry — D-4 (설계서 §3-2 초안 채택).
 * 화면(trim 뷰)에는 나타나지 않고 **출력(PDF) 사이즈 계산에만** 사용된다.
 */
export interface CaseBindSpec {
  /** 합지(보드) 두께 mm — 책등 폭에 ×2 가산 */
  boardThicknessMm: number;
  /** 시접(보드 안쪽 접어넘김) mm — 사방 가산 */
  turnInMm: number;
  /** 보드 바깥 풀칠/감싸기 여유 mm — 사방 가산 */
  wrapMarginMm: number;
}

/** CaseBindSpec 유효성: 3필드 모두 유한 ≥ 0. (부분/비정상 값은 미설정으로 간주 — 출력 불변) */
export function isValidCaseBind(cb: Partial<CaseBindSpec> | null | undefined): cb is CaseBindSpec {
  if (!cb) return false;
  return [cb.boardThicknessMm, cb.turnInMm, cb.wrapMarginMm].every(
    (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
  );
}

/** 템플릿셋 coverConfig JSON 형상 (트랙 간 동결 인터페이스 ③) */
export interface TemplateSetCoverConfig {
  caseBind?: CaseBindSpec;
}

/**
 * 템플릿셋 커버 메타 (D-4). 데이터 소스는 template_sets 의 additive nullable 컬럼
 * (coverType varchar + coverConfig JSON) — 편집기는 옵셔널 체이닝으로 읽기만 한다(값 없으면 기존 동작).
 */
export interface TemplateSetCoverMeta {
  /** 커버 종류 코드 — string 기반(고정 enum 금지). 시드는 COVER_TYPE_SEED_CODES 참조 */
  coverType: string;
  coverConfig?: TemplateSetCoverConfig;
}

export interface TemplateSet {
  id: string;
  name: string;
  thumbnailUrl?: string;
  type: TemplateSetType;
  editorMode: EditorMode;     // 에디터 모드 (단일/책)
  width: number;              // 판형 (mm)
  height: number;             // 판형 (mm)
  canAddPage: boolean;        // 내지 추가 가능 여부
  pageCountRange: number[];   // 내지 수량 범위 (예: [10, 20, 30, 40])
  templates: TemplateRef[];   // 순서 포함, N:N 관계
  isDeleted: boolean;         // 소프트 삭제
  /**
   * 에디터 좌측 도구 메뉴 노출 화이트리스트.
   * - null/undefined: 모든 메뉴 노출 (legacy/기본값)
   * - 배열: 배열에 포함된 키만 노출 (예: ['UPLOAD','TEXT','IMAGE'])
   * - 빈 배열: 모든 도구 메뉴 숨김 (※ 업로드만 별도 노출하려면 ['UPLOAD'])
   * Admin 의 템플릿셋 편집 화면에서 토글로 설정.
   */
  enabledMenus?: EditorMenuKey[] | null;
  /**
   * 면지 구성 — Phase 2 (2026-05-19).
   * null/undefined: 면지 없음 (legacy/기본).
   */
  endpaperConfig?: EndpaperConfig | null;
  /**
   * 표지 편집 가능 여부 — Phase 2 (2026-05-19).
   * - true (기본): 일반 책 표지 — 편집기에서 디자인 가능
   * - false: 레더 커버 / 화보집 — 표지는 미리보기 이미지로만 노출, 빈 PDF + 네이밍으로 인쇄
   */
  coverEditable: boolean;
  /**
   * 레더 커버 / 화보집용 표지 미리보기 이미지 storage URL — Phase 2 (2026-05-19).
   * 결정 3-5: 별도 필드. 표지 템플릿 객체로 우회하지 않음.
   * `coverEditable=false` 일 때만 의미 있음.
   */
  coverPreviewImage?: string | null;
  /**
   * 내지 PDF 첨부 파일 편집 가능 여부 — 표시전용 임포지션 (2026-06-08).
   * - true (기본): underlay 가이드 위 내지 편집 허용.
   * - false: 첨부 PDF를 가이드로만 표시, 내지 캔버스 편집 차단 + 첫 페이지 레이블.
   * ⚠️ 어느 쪽이든 최종 내지 인쇄는 첨부 원본 PDF 그대로(편집 미반영).
   */
  contentPdfEditable?: boolean;
  /**
   * PDF 출력 모드 — 인쇄물 구성에 따라 워커의 최종 PDF 생성 방식 결정 (2026-06-09).
   * - 'single': 단면(포스터 등) — 1 PDF에 1페이지.
   * - 'duplex-merged': 양면 — 1 PDF에 앞,뒤(,앞,뒤...) 순서로 한 파일 (기본).
   * - 'duplex-split': 양면 — 앞/뒤 한 세트씩 잘라 개별 PDF(각 2페이지) n개.
   * (책 모드 spread 셋은 기존 compose-mixed 경로가 우선 — 이 옵션은 단일/낱장 상품에 적용)
   */
  pdfOutputMode?: PdfOutputMode;
  /**
   * 색 처리 모드 — 상품에 따라 출력 PDF의 색공간 결정 (2026-06-09).
   * - 'rgb': RGB 유지(기본). 현재 파이프라인 동작 그대로.
   * - 'cmyk': 출력 시 RGB 객체를 CMYK로 변환(인쇄 색 정확도). 워커 ColorConversionStrategy/ICC.
   * ※ 워커의 실제 변환 적용은 인쇄 출력 영향 → 별도(스테이징) 적용. 필드는 의도 저장.
   */
  colorMode?: ColorOutputMode;
  /**
   * ④ 노출 라이브러리 카테고리 ID 목록 (2026-06-09). 에디터 에셋(배경/도형/클립아트/프레임/폰트)을
   * 상품·템플릿셋별로 큐레이션. 빈 배열/undefined = 전역(모든 카테고리 노출). 값이 있으면 그 카테고리만.
   * (조인 테이블 template_set_library_categories 에서 populate)
   */
  libraryCategoryIds?: string[];
  /**
   * PHOTOBOOK 페이지 가변 가격 메타 — Phase 2 (2026-06-24).
   * storige 는 가격을 계산하지 않는다(설계 §3-4·§8). 이 메타를 저장하고 편집 완료 시
   * 현재 총 pageCount 와 함께 emit 하면, 파트너 장바구니가 실제 가/감 가격을 계산한다.
   * 가격식(참고): base + max(0, pageCount − includedPages) × perPageUnit.
   * null/undefined = 가변 가격 미사용(BOOK/LEAFLET 등 기존 동작 비파괴).
   */
  pricing?: PhotobookPricing | null;
  // Legacy fields (하위 호환)
  description?: string;
  categoryId?: string;
  productSpecs?: ProductSpecs;
  items?: TemplateSetItem[];
  isActive?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * PDF 출력(생성) 모드. 'single'=단면 1p, 'duplex-merged'=양면 1파일(앞,뒤,...),
 * 'duplex-split'=앞/뒤 세트별 개별 PDF(각 2p). 기본 'duplex-merged'.
 */
export type PdfOutputMode = 'single' | 'duplex-merged' | 'duplex-split';

/**
 * 색 처리(출력 색공간) 모드. 'rgb'=RGB 유지(기본), 'cmyk'=출력 시 CMYK 변환(인쇄).
 */
export type ColorOutputMode = 'rgb' | 'cmyk';

/**
 * 템플릿셋 생성 입력
 */
export interface CreateTemplateSetInput {
  name: string;
  thumbnailUrl?: string;
  type: TemplateSetType;
  width: number;
  height: number;
  canAddPage?: boolean;
  pageCountRange?: number[];
  templates?: TemplateRef[];
  categoryId?: string;
  /** 에디터 도구 메뉴 노출 화이트리스트 (null=모두 노출) */
  enabledMenus?: EditorMenuKey[] | null;
  /** 인쇄 워크플로우 v1 Phase 3 (2026-05-19) — 면지/표지/레더커버 */
  endpaperConfig?: EndpaperConfig | null;
  coverEditable?: boolean;
  coverPreviewImage?: string | null;
  /** 내지 PDF 첨부 파일 편집 가능 여부 (2026-06-08, 기본 true) */
  contentPdfEditable?: boolean;
  /** PDF 출력 모드 (2026-06-09, 기본 'duplex-merged') */
  pdfOutputMode?: PdfOutputMode;
  /** 색 처리 모드 (2026-06-09, 기본 'rgb') */
  colorMode?: ColorOutputMode;
  /** ④ 노출 라이브러리 카테고리 ID 목록 (빈/미지정=전역) */
  libraryCategoryIds?: string[];
  /** PHOTOBOOK 페이지 가변 가격 메타 (2026-06-24, null/미지정=미사용) */
  pricing?: PhotobookPricing | null;
}

/**
 * 템플릿셋 수정 입력
 */
export interface UpdateTemplateSetInput {
  name?: string;
  thumbnailUrl?: string;
  type?: TemplateSetType;
  width?: number;
  height?: number;
  canAddPage?: boolean;
  pageCountRange?: number[];
  templates?: TemplateRef[];
  /** 에디터 도구 메뉴 노출 화이트리스트 (null=모두 노출) */
  enabledMenus?: EditorMenuKey[] | null;
  /** 인쇄 워크플로우 v1 Phase 3 (2026-05-19) — 면지/표지/레더커버 */
  endpaperConfig?: EndpaperConfig | null;
  coverEditable?: boolean;
  coverPreviewImage?: string | null;
  /** 내지 PDF 첨부 파일 편집 가능 여부 (2026-06-08, 기본 true) */
  contentPdfEditable?: boolean;
  /** PDF 출력 모드 (2026-06-09, 기본 'duplex-merged') */
  pdfOutputMode?: PdfOutputMode;
  /** 색 처리 모드 (2026-06-09, 기본 'rgb') */
  colorMode?: ColorOutputMode;
  /** ④ 노출 라이브러리 카테고리 ID 목록 (빈/미지정=전역) */
  libraryCategoryIds?: string[];
  /** PHOTOBOOK 페이지 가변 가격 메타 (2026-06-24, null/미지정=미사용) */
  pricing?: PhotobookPricing | null;
}

/**
 * 템플릿셋 아이템 (Legacy - 하위 호환용)
 */
export interface TemplateSetItem {
  id: string;
  templateSetId: string;
  templateId: string;
  sortOrder: number;
  required?: boolean;
}

/**
 * 상품 스펙 (Legacy)
 */
export interface ProductSpecs {
  size: {
    width: number;
    height: number;
    unit: 'mm' | 'cm' | 'inch';
  };
  pages: number;
  binding: 'perfect' | 'saddle' | 'none';
  bleed: number;
  orientation: 'portrait' | 'landscape';
}

// ============================================================================
// Canvas / Editor
// ============================================================================

export interface CanvasData {
  version: string;
  width: number;
  height: number;
  objects: FabricObject[];
  background?: string | FabricObject;
}

export interface FabricObject {
  type: string;
  isUserAdded?: boolean;      // 사용자가 추가한 요소 여부 (템플릿 교체 시 보존)
  isLocked?: boolean;         // 잠금 상태
  [key: string]: any;
}

/**
 * 편집 상태
 * - draft: 편집 중 (고객 편집 가능)
 * - review: 검토 중 (관리자 편집 가능)
 * - submitted: 완료 (관리자 편집 가능, 기록 남김)
 */
export enum EditStatus {
  DRAFT = 'draft',
  REVIEW = 'review',
  SUBMITTED = 'submitted',
}

/**
 * 편집 페이지 (에디터 내 개별 페이지)
 */
export interface EditPage {
  id: string;
  templateId: string;
  templateType: TemplateType;
  canvasData: CanvasData;
  sortOrder: number;
  required: boolean;
  deleteable: boolean;
}

/**
 * 편집 세션
 * 사용자의 편집 작업 상태를 저장
 */
export interface EditSession {
  id: string;
  userId?: string;
  orderId?: string;
  templateSetId: string;
  templateSet?: TemplateSet;  // 조인된 템플릿셋 정보 (optional)
  pages: EditPage[];          // 페이지별 캔버스 데이터
  status: EditStatus;
  metadata?: EditSessionMetadata; // 스프레드 모드 스냅샷
  // 동시 편집 방지
  lockedBy?: string;
  lockedAt?: Date;
  // 수정 기록
  modifiedBy?: string;
  modifiedAt?: Date;
  /**
   * 고객 첨부 내지 PDF — 인쇄 워크플로우 v1 Phase 2 (2026-05-19).
   * 결정 3-3: PDF 첨부와 일부 편집은 배타적 (둘 다 동시 불가).
   * 결정 3-4: 워커 검증 실패 시 첨부 자체 거부 (validationResult 에 issue 누적되면 클라이언트가 거부 UI 노출).
   */
  contentPdfFileId?: string | null;
  /** PDF 페이지수 (자동 페이지 확장 계산용) */
  contentPdfPageCount?: number | null;
  /** 워커 검증 결과 캐시 (issues, warnings, metadata 등) */
  contentPdfValidationResult?: Record<string, unknown> | null;
  /**
   * 내지 PDF 첨부 모드 — 표시전용 임포지션 (2026-06-07).
   * - 'replace'(기본/레거시): PDF 만 인쇄, 캔버스 편집 배타(PDF_ATTACHED_EXCLUSIVE).
   * - 'underlay'(표시전용): PDF 각 페이지를 `excludeFromExport:true` 잠금배경 가이드로 표시,
   *   그 위 편집 허용. 단 최종 내지 인쇄는 원본 PDF 그대로(편집 미반영).
   * null 은 'replace' 로 간주(기존 세션 호환).
   */
  contentPdfMode?: 'replace' | 'underlay' | null;
  /**
   * 게스트 식별자 — Phase 2 (2026-05-19).
   * 결정 3-1: 24시간 후 자동 삭제. 결정 3-6: 저장(편집완료) 시점에만 회원 전환 유도.
   */
  guestToken?: string | null;
  /** 게스트 작업 자동 삭제 시점 (NOW + 24h). 회원 가입 시 NULL 로 클리어 */
  guestExpiresAt?: Date | null;
  // Legacy fields
  templateId?: string;
  canvasData?: CanvasData;
  orderOptions?: OrderOptions;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 편집 세션 생성 입력
 */
export interface CreateEditSessionInput {
  templateSetId: string;
  orderId?: string;
  userId?: string;
}

/**
 * 편집 세션 저장 입력 (자동저장용)
 */
export interface SaveEditSessionInput {
  pages?: EditPage[];
  currentPageIndex?: number;
}

/**
 * 편집 이력
 */
export interface EditHistory {
  id: string;
  sessionId: string;
  userId: string;
  userName?: string;
  action: string;
  details?: string;
  createdAt: Date;
}

export interface OrderOptions {
  size: {
    width: number;
    height: number;
    unit: 'mm' | 'cm' | 'inch';
  };
  pages: number;
  binding: 'perfect' | 'saddle' | 'none';
  bleed: number;
}

// ============================================================================
// Library
// ============================================================================

/**
 * 라이브러리 카테고리 타입
 */
export type LibraryCategoryType = 'background' | 'shape' | 'frame' | 'clipart' | 'font';

/**
 * 라이브러리 카테고리 (계층형)
 */
export interface LibraryCategory {
  id: string;
  name: string;
  type: LibraryCategoryType;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  children?: LibraryCategory[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryFont {
  id: string;
  name: string;
  fileUrl: string;
  fileFormat: 'ttf' | 'otf' | 'woff' | 'woff2';
  isActive: boolean;
  createdAt: Date;
}

export interface LibraryBackground {
  id: string;
  name: string;
  fileUrl: string;
  thumbnailUrl?: string;
  category?: string;
  categoryId?: string;
  isActive: boolean;
  createdAt: Date;
}

/**
 * 도형 에셋
 */
export interface LibraryShape {
  id: string;
  name: string;
  fileUrl: string;
  thumbnailUrl?: string;
  categoryId?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
}

/**
 * 사진틀 에셋
 */
export interface LibraryFrame {
  id: string;
  name: string;
  fileUrl: string;
  thumbnailUrl?: string;
  categoryId?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
}

export interface LibraryClipart {
  id: string;
  name: string;
  fileUrl: string;
  thumbnailUrl?: string;
  category?: string;
  categoryId?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
}

// ============================================================================
// Worker / PDF Processing
// ============================================================================

export enum WorkerJobType {
  VALIDATE = 'VALIDATE',
  CONVERT = 'CONVERT',
  SYNTHESIZE = 'SYNTHESIZE',
  /**
   * 내지 PDF 표시전용 임포지션(2026-06-07): 첨부 내지 PDF 각 페이지를
   * 이미지로 래스터화 → 편집기에 `excludeFromExport:true` 잠금 가이드로 표시.
   * 최종 인쇄엔 미반영(원본 PDF 그대로). 워커 GS pdfToImage 재사용.
   */
  RENDER_PAGES = 'RENDER_PAGES',
}

export enum WorkerJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  /** 오류가 있으나 모두 자동 수정 가능한 경우 (예: 블리드 미설정, 여백 페이지 부족) */
  FIXABLE = 'FIXABLE',
  FAILED = 'FAILED',
}

export interface WorkerJob {
  id: string;
  jobType: WorkerJobType;
  status: WorkerJobStatus;
  inputFileUrl?: string;
  outputFileUrl?: string;
  options?: ValidationOptions | ConversionOptions | SynthesisOptions;
  /**
   * 잡 결과. VALIDATE 잡의 런타임 실물은 `WorkerValidationResult`
   * ({isValid, errors, warnings, metadata} — 워커 DTO 정본, S-1 2026-07-15).
   * 구형 `ValidationResult`({valid, fileInfo})는 하위호환 선언으로만 유지.
   */
  result?: ValidationResult | WorkerValidationResult | ConversionResult | SynthesisResult;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
  /** Phase C — 사이트 컨텍스트 (외부 X-API-Key 호출 시 자동 주입) */
  siteId?: string | null;
}

// Validation
export interface ValidationOptions {
  fileType: 'cover' | 'content';
  orderOptions: OrderOptions;
  /**
   * [S2-5, 2026-07-16] test env 파트너 키 컨텍스트로 생성된 잡 마커 (additive).
   * API 잡 생성 서비스가 인증 컨텍스트 env==='test'일 때만 자동 스탬프한다 —
   * 호출자가 body 로 직접 세팅할 수 없다(DTO 비화이트리스트).
   * 현 시점(Stage 2) 잡 생성 표면은 전부 live(공용 ApiKeyGuard=sites 키)라 항상 미설정 —
   * 실발화는 Stage 3(v1 books 잡 생성 표면)에서 일어난다.
   * true 인 잡: 완료 웹훅 v2 발신 시 페이로드 isTest 반영 + 합성 산출물은 TEST
   * 워터마크 더미 + outputs 24h retention(TestJobOutputsRetentionService).
   */
  isTest?: boolean;
}

/**
 * @deprecated 워커 런타임 발신 shape 과 불일치하는 구형 선언({valid, fileInfo}).
 * 워커가 실제로 발신하는 검증 결과는 `WorkerValidationResult`({isValid, metadata}) 다.
 * S-1 정본화(2026-07-15) — 신규 코드는 `WorkerValidationResult` 를 사용하라.
 * 기존 참조 호환을 위해 유지: 필드 변경·삭제 금지(additive-only).
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  fileInfo: {
    pages: number;
    size: { width: number; height: number };
    hasBleed: boolean;
    colorMode: string;
    resolution: number;
  };
}

/**
 * @deprecated 구형 `ValidationResult` 전용 에러 선언. 워커 실물 에러는
 * `WorkerValidationError`({code, message, details, autoFixable, fixMethod?}) 다.
 */
export interface ValidationError {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * @deprecated 구형 `ValidationResult` 전용 경고 선언. 워커 실물 경고는
 * `WorkerValidationWarning`({code, message, details?, autoFixable, fixMethod?}) 다.
 */
export interface ValidationWarning {
  code: string;
  message: string;
}

// ============================================================================
// Worker 검증 결과 정본 (Stage 0 S-1, 2026-07-15)
// ----------------------------------------------------------------------------
// 정본은 apps/worker/src/dto/validation-result.dto.ts 의 ValidationResultDto.
// 아래 타입들은 그 DTO 와 필드 1:1 미러이며, 구조 일치는
// apps/worker/src/dto/validation-result-contract.spec.ts 가 컴파일 타임에 고정한다.
// (워커 DTO 의 enum 코드값은 여기서 string 상위 타입으로 수용 — 워커→정본 방향
//  할당 가능성이 계약이다. 이 타입을 바꾸려면 위 spec 이 함께 green 이어야 한다.)
// ============================================================================

/** 워커 검증 에러 (워커 DTO `ValidationError` 미러 — code 는 워커 ErrorCode enum 값) */
export interface WorkerValidationError {
  /** 에러 코드 (워커 ErrorCode enum 값 문자열) */
  code: string;
  /** 사용자 표시 메시지 */
  message: string;
  /** 상세 정보 (유연한 구조) */
  details: Record<string, unknown>;
  /** 자동 수정 가능 여부 */
  autoFixable: boolean;
  /** 수정 방법 */
  fixMethod?: 'addBlankPages' | 'extendBleed' | 'adjustSpine' | 'resizeWithPadding';
}

/** 워커 검증 경고 (워커 DTO `ValidationWarning` 미러 — code 는 워커 WarningCode enum 값) */
export interface WorkerValidationWarning {
  /** 경고 코드 (워커 WarningCode enum 값 문자열) */
  code: string;
  /** 사용자 표시 메시지 */
  message: string;
  /** 상세 정보 */
  details?: unknown;
  /** 자동 수정 가능 여부 */
  autoFixable: boolean;
  /** 수정 방법 */
  fixMethod?: string;
}

/** 워커 PDF 메타데이터 (워커 DTO `PdfMetadata` 미러) */
export interface WorkerPdfMetadata {
  /** 페이지 수 */
  pageCount: number;
  /** 페이지 크기 (mm) */
  pageSize: {
    width: number;
    height: number;
  };
  /** 재단 여백 포함 여부 */
  hasBleed: boolean;
  /** 재단 여백 크기 (mm) */
  bleedSize?: number;
  /** 책등 크기 (mm) */
  spineSize?: number;
  /** 해상도 (DPI) */
  resolution?: number;
  /** 컬러 모드 */
  colorMode?: string;
  /** 스프레드 감지 정보 */
  spreadInfo?: {
    /** 스프레드 형식 여부 */
    isSpread: boolean;
    /** 감지 점수 (0-100) */
    score: number;
    /** 신뢰도 */
    confidence: 'high' | 'medium' | 'low';
    /** 감지된 PDF 타입 */
    detectedType: 'single' | 'spread' | 'mixed';
  };
  /** 별색 포함 여부 */
  hasSpotColors?: boolean;
  /** 별색 이름 목록 */
  spotColors?: string[];
  /** 투명도 포함 여부 */
  hasTransparency?: boolean;
  /** 오버프린트 포함 여부 */
  hasOverprint?: boolean;
  /** 이미지 개수 */
  imageCount?: number;
  /** 감지된 폰트 수 */
  fontCount?: number;
  /** 임베딩되지 않은 폰트 존재 여부 */
  hasUnembeddedFonts?: boolean;
  /** 임베딩되지 않은 폰트 이름 목록 */
  unembeddedFonts?: string[];
  /** C-2a: 첫 페이지 TrimBox 크기(mm, 소수1자리) — TrimBox 명시 선언 시에만 기록 */
  trimBox?: { width: number; height: number };
  /** C-2a: 재단 기하(TrimBox) 명시 선언 여부 — crop mark 검증 수행 시에만 기록 */
  hasCropMarkGeometry?: boolean;
}

/**
 * 워커 검증 결과 정본 (Stage 0 S-1, 2026-07-15).
 *
 * 워커가 실제로 발신하는 런타임 shape: `{isValid, errors, warnings, metadata}`.
 * apps/worker/src/dto/validation-result.dto.ts `ValidationResultDto` 와 필드 1:1.
 * 구형 `ValidationResult`({valid, fileInfo})는 런타임과 불일치하는 레거시 선언으로,
 * @deprecated 별칭으로만 유지된다(삭제 금지).
 */
export interface WorkerValidationResult {
  /** 검증 통과 여부 */
  isValid: boolean;
  /** 에러 목록 */
  errors: WorkerValidationError[];
  /** 경고 목록 */
  warnings: WorkerValidationWarning[];
  /** PDF 메타데이터 */
  metadata: WorkerPdfMetadata;
}

// Conversion
export interface ConversionOptions {
  addPages: boolean;
  applyBleed: boolean;
  targetPages: number;
  bleed: number;
}

export interface ConversionResult {
  success: boolean;
  outputFileUrl: string;
  pagesAdded: number;
  bleedApplied: boolean;
}

// Synthesis
export interface SynthesisOptions {
  coverUrl: string;
  contentUrl: string;
  spineWidth: number;
  bindingType?: 'perfect' | 'saddle' | 'hardcover';
  generatePreview?: boolean;
  outputFormat?: 'merged' | 'separate'; // 요청 옵션, 기본값: 'merged'
  /** [S2-5] test env 잡 마커 — `ValidationOptions.isTest` 주석 참조 (additive) */
  isTest?: boolean;
}

/**
 * Compose-mixed 출력 모드.
 * - separate: cover.pdf + content.pdf (일반 책자)
 * - content-only: content.pdf만 (레더커버)
 * - single: pages.pdf (낱장 상품 — 카드/명함/엽서/포스터/리플렛)
 */
export type ComposeOutputMode = 'separate' | 'content-only' | 'single';

// ============================================================================
// Split Synthesis (단일 PDF 분리)
// ============================================================================

/**
 * 페이지 타입 배열 (★ v1.1+ 권장: 객체 대신 배열 사용)
 * - 길이 == totalPages로 완전성 자연스럽게 강제
 * - 검증이 pageTypes.length !== totalPages로 단순화
 * - 누락 불가능 (배열은 인덱스 존재)
 */
export type PageTypes = Array<'cover' | 'content'>;

/**
 * 페이지 타입 맵 (하위호환용, 권장하지 않음)
 */
export interface PageTypeMap {
  [pageIndex: number]: 'cover' | 'content';
}

/**
 * PDF 분리 결과 (내부용)
 */
export interface SplitResult {
  coverPath: string;
  contentPath: string;
  coverPageCount: number;
  contentPageCount: number;
}

/**
 * Split Synthesis Job 옵션
 */
export interface SplitSynthesisOptions {
  mode: 'split';
  pageTypes: PageTypes;
  totalExpectedPages: number;
  outputFormat: 'merged' | 'separate';
  alsoGenerateMerged?: boolean;
  /** [S2-5] test env 잡 마커 — `ValidationOptions.isTest` 주석 참조 (additive) */
  isTest?: boolean;
}

/**
 * Split Synthesis Job Data (Worker Queue Payload)
 * ★ mode는 Queue payload의 단일 진실 공급원
 */
export interface SplitSynthesisJobData {
  jobId: string;
  mode: 'split';               // ★ 필수: handleSynthesis() 분기 기준
  sessionId: string;           // ★ 이중 검증용
  pdfFileId: string;           // ★ pdfUrl 대신 fileId (Worker가 조회)
  pageTypes: PageTypes;        // ★ 배열 방식 권장
  totalExpectedPages: number;
  outputFormat: 'merged' | 'separate';
  alsoGenerateMerged?: boolean;
  callbackUrl?: string;
  /**
   * [S2-5] test env 잡 마커. ⚠️ 큐 페이로드는 명시 구성이므로(직렬화 등재 필요)
   * API 잡 생성부가 isTest 잡에만 conditional spread 로 싣는다 — live 잡 페이로드 바이트 불변.
   * 워커 SynthesisProcessor 는 이 플래그로 실합성 대신 TEST 워터마크 더미 산출 분기.
   */
  isTest?: boolean;
}

/**
 * Duplex-split Synthesis Job Data (Worker Queue Payload) — 2026-06-09.
 *
 * 단일/낱장 양면 상품의 편집기 산출 단일 PDF(앞,뒤,앞,뒤… 순서)를
 * 앞/뒤 한 세트(각 2페이지)씩 잘라 개별 PDF n개로 분리한다.
 * (TemplateSet.pdfOutputMode='duplex-split' 일 때만 발행)
 *
 * ★ mode는 Queue payload의 단일 진실 공급원. split 모드(cover/content 분리)와 별개.
 */
export interface DuplexSplitSynthesisJobData {
  jobId: string;
  mode: 'duplex-split';        // ★ 필수: handleSynthesis() 분기 기준
  sessionId: string;           // ★ 이중 검증용
  pdfFileId: string;           // ★ 편집기 산출 단일 PDF (Worker가 fileId로 조회)
  totalExpectedPages: number;  // ★ 원본 PDF 기대 페이지 수(짝수여야 함 = 2 × 세트 수)
  callbackUrl?: string;
}

/**
 * PDF Synthesizer 내부 결과 (로컬 파일 경로)
 * Synthesizer → Processor 전달용
 */
export interface SynthesisLocalResult {
  success: boolean;

  // 다운로드 원본 (cleanup 대상)
  sourceCoverPath: string;
  sourceContentPath: string;

  // 출력 파일 (cleanup 대상)
  mergedPath: string;
  coverPath?: string; // separate 모드에서만
  contentPath?: string; // separate 모드에서만

  totalPages: number;
}

/**
 * 분리 출력 시 개별 파일 정보
 * - 'cover' / 'content': 책 분리(split) 출력.
 * - 'pages': compose-mixed single(낱장) 출력.
 * - 'set': duplex-split 출력 — 앞/뒤 한 세트(각 2페이지) 개별 PDF (2026-06-09).
 *   setIndex 로 세트 순번(0-base)을 표기.
 */
export interface OutputFile {
  type: 'cover' | 'content' | 'pages' | 'set';
  url: string;
  pageCount?: number;
  /** duplex-split('set') 전용 — 세트 순번(0-base, 편집기 페이지 순서 기준) */
  setIndex?: number;
}

/**
 * 최종 결과 (Processor → API)
 */
export interface SynthesisResult {
  success: boolean;
  outputFileUrl?: string; // merged URL (하위호환). spread 모드에서는 merged 없으면 undefined
  outputFiles?: OutputFile[]; // separate 모드에서만 추가 (cover → content 순서)
  previewUrl?: string;
  totalPages?: number; // merged PDF 기준 총 페이지 수
  /** [S2-5] test env 더미 산출물 마커 — isTest 잡 결과에만 true (additive, live 결과 불변) */
  isTest?: boolean;
}

/**
 * 검증 완료 웹훅 페이로드
 * POST /worker-jobs/validate/external 의 callbackUrl로 전송
 */
export interface ValidationWebhookPayload {
  event: 'validation.completed' | 'validation.fixable' | 'validation.failed';
  jobId: string;
  /** 편집 세션 ID — job.editSessionId가 있을 때만 포함 (WH-005) */
  sessionId?: string;
  /** 검증 대상 파일 타입 */
  fileType: 'cover' | 'content' | 'post_process';
  /** 연결된 주문 번호 — bookmoa orderOptions.orderSeqno echo-back (WH-005) */
  orderSeqno?: number;
  status: 'completed' | 'fixable' | 'failed';
  /** 검증 결과 상세 (errors, warnings, metadata) */
  result?: any;
  /** 실패/수정필요 시 에러 메시지 요약 */
  errorMessage?: string;
  timestamp: string;
}

/**
 * Synthesis 웹훅 페이로드
 */
export interface SynthesisWebhookPayload {
  event: 'synthesis.completed' | 'synthesis.failed';
  jobId: string;
  sessionId?: string; // EditSession ID (additive, NEW_DEV_PLAN §3.5 계약 보강)
  orderId?: string;
  /** bookmoa orderOptions.orderSeqno echo-back — orders 테이블 원자 갱신용 (WH-005) */
  orderSeqno?: number;
  status: 'completed' | 'failed';

  // 하위호환 필수
  outputFileUrl: string; // 항상 merged URL (failed면 '')

  // separate 모드에서만 추가 (존재 시 cover→content 순서 보장)
  outputFiles?: OutputFile[];

  // 요청 옵션 echo-back
  outputFormat?: 'merged' | 'separate';

  // 디버깅용
  queueJobId?: string | number; // Bull queue ID

  // 실패 시
  errorMessage?: string;

  timestamp: string;
}

/**
 * Book finalization 웹훅 페이로드 (Partner API v1 Stage 3 W3).
 *
 * finalization 완료/실패 시 사이트 v2 webhook config(opt-in)로 발신 — 폴링
 * (GET /api/v1/books/:uid/finalization)과 병행(설계서 §6.3). 기존 발신 7종과
 * 별개 additive 이벤트(webhook-v2.constants WEBHOOK_V2_SUBSCRIBABLE_EVENTS 등재).
 * 내부 UUID(id)는 비노출 — 외부 식별자(bk_.../fin_...)만 싣는다(§2.0).
 */
export interface BookFinalizationWebhookPayload {
  event: 'book.finalization.completed' | 'book.finalization.failed';
  /** 도서 외부 식별자 'bk_...' */
  bookUid: string;
  /** 최종화 이력 외부 식별자 'fin_...' */
  finalizationUid: string;
  status: 'completed' | 'failed';
  /** 확정 페이지 수 — completed 시 채움 */
  pageCount?: number | null;
  /** 최종 PDF files.id — GET /api/v1/books/:uid/pdf 로 소유검증 후 스트림(§9-10) */
  outputFileId?: string | null;
  /** 실패 시 ERR_* (§3 카탈로그) */
  errorCode?: string | null;
  timestamp: string;
  /** [S2-5] test env 더미 산출물 마커 — isTest 잡 결과에만 true(additive, live 결과 불변) */
  isTest?: boolean;
  /**
   * [P1-2] 워커 validate 를 건너뛰고 최종화됐음(book_spec 미연결 or pageCount 미확정 →
   * 대조 판형 부재). true 면 파트너는 미검증 FINALIZED 임을 인지하고 자체 게이팅 가능(§6.3).
   */
  validationSkipped?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T = any> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// Editor Config
// ============================================================================

export interface EditorConfig {
  container: string;
  orderId?: string;
  options?: EditorOptions;
  onComplete?: (result: EditorResult) => void;
}

export interface EditorOptions {
  mode: 1 | 2 | 3 | 4; // 편집 모드
  templateSetId?: string;
  templateId?: string;
  readonly?: boolean;
}

export interface EditorResult {
  canvasData: CanvasData;
  files?: {
    coverPdf?: string;
    contentPdf?: string;
  };
}

// ============================================================================
// Editor Design (사용자 디자인 저장)
// ============================================================================

export interface EditorDesign {
  id: string;
  userId: string;
  name: string;
  imageUrl?: string;
  mediaUrl: string;
  metadata: EditorDesignMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface EditorDesignMetadata {
  productId?: string;
  sizeNo?: string;
  totalPage: number;
  settings: Record<string, any>;
  isAdmin?: boolean;
}

export interface CreateEditorDesignInput {
  name: string;
  imageUrl?: string;
  mediaUrl: string;
  metadata: EditorDesignMetadata;
}

export interface UpdateEditorDesignInput {
  name?: string;
  imageUrl?: string;
  mediaUrl?: string;
  metadata?: Partial<EditorDesignMetadata>;
}

// ============================================================================
// Editor Content (에디터 에셋: 템플릿, 프레임, 이미지, 배경, 요소)
// ============================================================================

export type EditorContentType = 'template' | 'frame' | 'image' | 'background' | 'element';

export interface EditorContent {
  id: string;
  type: EditorContentType;
  name: string;
  imageUrl?: string;
  designUrl?: string;
  cutLineUrl?: string;
  tags: string[];
  metadata: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EditorContentFilter {
  type?: EditorContentType;
  tags?: string[];
  isActive?: boolean;
  search?: string;
  // 템플릿셋별 에셋 큐레이션(2026-06-09): 지정 시 해당 템플릿셋에 연결된 라이브러리 카테고리의
  // 에셋만 노출. 연결이 없으면 전역(모든 에셋) — 미지정 시와 동일 동작(하위호환).
  templateSetId?: string;
}

export interface EditorContentSort {
  field: 'name' | 'createdAt' | 'updatedAt';
  order: 'asc' | 'desc';
}

// ============================================================================
// Canvas Settings (캔버스 설정)
// ============================================================================

export type ColorMode = 'RGB' | 'CMYK';
export type SizeUnit = 'mm' | 'px' | 'inch';

export interface CanvasSettings {
  unit: SizeUnit;
  visibleUnit?: SizeUnit;
  colorMode: ColorMode;
  dpi: number;
  size: {
    width: number;
    height: number;
    cutSize: number;
    safeSize?: number;
    printSize?: { width: number; height: number };
  };
  showCutBorder: boolean;
  showSafeBorder?: boolean;
  editMode?: boolean;
  page: {
    count: number;
    min: number;
    max: number;
    interval: number;
  };
}

// ============================================================================
// Spine (책등) 관련 타입
// ============================================================================

/**
 * 종이 타입
 * 각 종이 타입별 두께(mm) 포함
 */
export enum PaperType {
  // 본문용
  MOJO_70G = 'mojo_70g',           // 모조지 70g
  MOJO_80G = 'mojo_80g',           // 모조지 80g
  SEOKJI_70G = 'seokji_70g',       // 서적지 70g
  NEWSPRINT_45G = 'newsprint_45g', // 신문지 45g
  // 표지용
  ART_200G = 'art_200g',           // 아트지 200g
  MATTE_200G = 'matte_200g',       // 매트지 200g
  CARD_300G = 'card_300g',         // 카드지 300g
  KRAFT_120G = 'kraft_120g',       // 크라프트지 120g
}

/**
 * 종이 두께 상수 (mm per sheet, 양면 1장 기준)
 */
export const PAPER_THICKNESS: Record<PaperType, number> = {
  [PaperType.MOJO_70G]: 0.09,
  [PaperType.MOJO_80G]: 0.10,
  [PaperType.SEOKJI_70G]: 0.10,
  [PaperType.NEWSPRINT_45G]: 0.06,
  [PaperType.ART_200G]: 0.18,
  [PaperType.MATTE_200G]: 0.20,
  [PaperType.CARD_300G]: 0.35,
  [PaperType.KRAFT_120G]: 0.16,
};

/**
 * 제본 방식
 */
export enum BindingType {
  PERFECT = 'perfect',     // 무선제본 (32p 이상)
  SADDLE = 'saddle',       // 중철제본 (64p 이하, 4의 배수)
  SPIRAL = 'spiral',       // 스프링제본
  HARDCOVER = 'hardcover', // 양장제본
}

/**
 * 제본 여유분 상수 (mm)
 */
export const BINDING_MARGIN: Record<BindingType, number> = {
  [BindingType.PERFECT]: 0.5,
  [BindingType.SADDLE]: 0.3,    // 0.2~0.4mm 평균
  [BindingType.SPIRAL]: 3.0,
  [BindingType.HARDCOVER]: 2.0,
};

/**
 * 제본 방식별 제한 조건
 */
export const BINDING_CONSTRAINTS: Record<BindingType, { minPages?: number; maxPages?: number; pageMultiple?: number }> = {
  [BindingType.PERFECT]: { minPages: 32 },
  [BindingType.SADDLE]: { maxPages: 64, pageMultiple: 4 },
  [BindingType.SPIRAL]: {},
  [BindingType.HARDCOVER]: {},
};

/**
 * 책등 설정
 */
export interface SpineConfig {
  pageCount: number;        // 페이지 수
  paperType: PaperType;     // 종이 종류
  bindingType: BindingType; // 제본 방식
}

/**
 * 책등 계산 결과
 */
export interface SpineCalculationResult {
  spineWidth: number;       // 계산된 책등 폭 (mm)
  paperThickness: number;   // 종이 두께 (mm per sheet)
  bindingMargin: number;    // 제본 여유분 (mm)
  warnings: SpineWarning[]; // 경고 메시지
}

/**
 * 책등 관련 경고
 */
export interface SpineWarning {
  code: 'SPINE_TOO_NARROW' | 'BINDING_PAGE_LIMIT' | 'BINDING_PAGE_MULTIPLE';
  message: string;
}

/**
 * 책등 폭 계산 함수 (유틸리티)
 * 공식: 책등 폭 = (페이지 수 ÷ 2) × 종이 두께 + 제본 여유분
 */
export function calculateSpineWidth(config: SpineConfig): SpineCalculationResult {
  const paperThickness = PAPER_THICKNESS[config.paperType];
  const bindingMargin = BINDING_MARGIN[config.bindingType];
  const constraints = BINDING_CONSTRAINTS[config.bindingType];

  const warnings: SpineWarning[] = [];

  // 제본 조건 검증
  if (constraints.minPages && config.pageCount < constraints.minPages) {
    warnings.push({
      code: 'BINDING_PAGE_LIMIT',
      message: `${config.bindingType} 제본은 최소 ${constraints.minPages}페이지 이상이어야 합니다.`,
    });
  }
  if (constraints.maxPages && config.pageCount > constraints.maxPages) {
    warnings.push({
      code: 'BINDING_PAGE_LIMIT',
      message: `${config.bindingType} 제본은 최대 ${constraints.maxPages}페이지까지 가능합니다.`,
    });
  }
  if (constraints.pageMultiple && config.pageCount % constraints.pageMultiple !== 0) {
    warnings.push({
      code: 'BINDING_PAGE_MULTIPLE',
      message: `${config.bindingType} 제본은 ${constraints.pageMultiple}의 배수 페이지여야 합니다.`,
    });
  }

  // 책등 폭 계산 — 음수 방지(무결성: 음수 책등은 펼침면 총폭을 줄여 영역 레이아웃을 붕괴시킴).
  const spineWidth = Math.max(0, (config.pageCount / 2) * paperThickness + bindingMargin);

  // 책등 폭 경고
  if (spineWidth < 5) {
    warnings.push({
      code: 'SPINE_TOO_NARROW',
      message: '책등 폭이 5mm 미만입니다. 텍스트 배치에 주의하세요.',
    });
  }

  return {
    spineWidth: Math.round(spineWidth * 100) / 100, // 소수점 둘째자리까지
    paperThickness,
    bindingMargin,
    warnings,
  };
}

// ============================================================================
// Spread 공용 계산 함수
// ============================================================================

/**
 * mm 값을 0.1mm 단위로 반올림
 * @throws {Error} NaN/Infinity 입력 시
 */
export function roundMm01(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`roundMm01: non-finite value ${x}`);
  return Math.round(x * 10) / 10;
}

/**
 * SpreadSpec 기본값 보충 + 0.1mm 정규화 (Editor/API 공용)
 */
export function normalizeSpreadSpec(raw: Partial<SpreadSpec> & {
  coverWidthMm: number;
  coverHeightMm: number;
  initialSpineWidthMm?: number;
}): SpreadSpec {
  return {
    coverWidthMm: roundMm01(raw.coverWidthMm),
    coverHeightMm: roundMm01(raw.coverHeightMm),
    spineWidthMm: roundMm01(raw.spineWidthMm ?? raw.initialSpineWidthMm ?? 7.5),
    wingEnabled: raw.wingEnabled ?? false,
    wingWidthMm: roundMm01(raw.wingWidthMm ?? 0),
    cutSizeMm: roundMm01(raw.cutSizeMm ?? 3),
    safeSizeMm: roundMm01(raw.safeSizeMm ?? 3),
    dpi: raw.dpi ?? 150,
    // D-4 (2026-07-06): 싸바리 geometry 보존(additive) — 유효할 때만 0.1mm 정규화해 유지.
    // 비유효/미설정이면 필드 자체를 생략해 기존 스냅샷과 byte-identical.
    ...(isValidCaseBind(raw.caseBind)
      ? {
          caseBind: {
            boardThicknessMm: roundMm01(raw.caseBind.boardThicknessMm),
            turnInMm: roundMm01(raw.caseBind.turnInMm),
            wrapMarginMm: roundMm01(raw.caseBind.wrapMarginMm),
          },
        }
      : {}),
  };
}

/**
 * 스프레드 총 크기 계산 결과
 */
export interface SpreadDimensions {
  totalWidthMm: number;   // roundMm01 적용
  totalHeightMm: number;  // roundMm01 적용
}

/**
 * 스프레드 총 크기 계산 (단일 소스 - Admin/Editor/API 공용)
 */
export function computeSpreadDimensions(spec: SpreadSpec): SpreadDimensions {
  const rawWidth =
    (spec.wingEnabled ? spec.wingWidthMm * 2 : 0)
    + spec.coverWidthMm * 2
    + spec.spineWidthMm;
  return {
    totalWidthMm: roundMm01(rawWidth),
    totalHeightMm: roundMm01(spec.coverHeightMm),
  };
}

/**
 * D-4 (2026-07-06): 스프레드 **출력(PDF) 사이즈** 계산 — 싸바리(caseBind) wrap 포함.
 *
 * 이중경계 원칙: 화면(trim 뷰)은 computeSpreadDimensions(위, **불변**)를 그대로 쓰고,
 * PDF 생성 시에만 이 함수의 출력 사이즈를 페이지 크기로 쓴다(콘텐츠는 중앙 배치).
 *
 * 공식(설계서 §3-2): 출력 폭 = trim 총폭 + boardThicknessMm×2(책등 가산) + (turnIn+wrap)×2,
 * 출력 높이 = trim 높이 + (turnIn+wrap)×2.
 *
 * caseBind 미설정/비유효 → computeSpreadDimensions 와 동일값(기존 totalWidthMm 출력 byte-parity).
 */
export function computeSpreadOutputDimensions(spec: SpreadSpec): SpreadDimensions {
  const base = computeSpreadDimensions(spec);
  const cb = spec.caseBind;
  if (!isValidCaseBind(cb)) return base;
  const wrapPerSideMm = cb.turnInMm + cb.wrapMarginMm;
  return {
    totalWidthMm: roundMm01(base.totalWidthMm + cb.boardThicknessMm * 2 + wrapPerSideMm * 2),
    totalHeightMm: roundMm01(base.totalHeightMm + wrapPerSideMm * 2),
  };
}

/**
 * B48/B49: 클라이언트가 제출한 스프레드 스펙(스냅샷)을 권위 스펙(Template.spreadConfig.spec)과 대조.
 *
 * ⚠️ 책등(spineWidthMm)·총폭(totalWidthMm)은 **비교하지 않는다** — 책등은 주문 페이지수/용지에 따라
 *    동적으로 결정되므로 정적 템플릿 스펙과 다른 게 정상이다. 템플릿이 고정하는 **기하(표지 가로/세로,
 *    날개 유무/폭)만** 허용오차 내 일치를 검증한다.
 *
 * @param candidate 클라이언트 제출 스펙(metadata.spread.spec 등)
 * @param authority 권위 스펙(템플릿 spreadConfig.spec)
 * @param toleranceMm 허용오차(기본 0.2mm)
 * @returns { ok, mismatches } — mismatches 가 비면 일치
 */
export function validateSpreadAgainstAuthority(
  candidate: Pick<SpreadSpec, 'coverWidthMm' | 'coverHeightMm' | 'wingEnabled' | 'wingWidthMm'> | null | undefined,
  authority: Pick<SpreadSpec, 'coverWidthMm' | 'coverHeightMm' | 'wingEnabled' | 'wingWidthMm'> | null | undefined,
  toleranceMm = 0.2,
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  // 한쪽이라도 없으면 검증 불가 → PASS(레거시/비스프레드 무영향)
  if (!candidate || !authority) return { ok: true, mismatches };
  const near = (a: number, b: number) => Math.abs((a ?? 0) - (b ?? 0)) <= toleranceMm;
  if (!near(candidate.coverWidthMm, authority.coverWidthMm)) {
    mismatches.push(`COVER_WIDTH_MISMATCH: ${candidate.coverWidthMm}mm vs 권위 ${authority.coverWidthMm}mm`);
  }
  if (!near(candidate.coverHeightMm, authority.coverHeightMm)) {
    mismatches.push(`COVER_HEIGHT_MISMATCH: ${candidate.coverHeightMm}mm vs 권위 ${authority.coverHeightMm}mm`);
  }
  if (!!candidate.wingEnabled !== !!authority.wingEnabled) {
    mismatches.push(`WING_ENABLED_MISMATCH: ${candidate.wingEnabled} vs 권위 ${authority.wingEnabled}`);
  } else if (authority.wingEnabled && !near(candidate.wingWidthMm, authority.wingWidthMm)) {
    mismatches.push(`WING_WIDTH_MISMATCH: ${candidate.wingWidthMm}mm vs 권위 ${authority.wingWidthMm}mm`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ============================================================================
// 권한 관련 타입
// ============================================================================

/**
 * 사용자 유형별 권한
 */
export interface UserPermissions {
  canEdit: boolean;                // 기본 편집 권한
  canAddDeletePages: boolean;      // 페이지 추가/삭제
  canReplaceTemplate: boolean;     // 템플릿 교체
  canUnlockElements: boolean;      // 잠금 요소 해제
  canChangeStatus: boolean;        // 상태 변경 (review, submitted)
  canViewAllSessions: boolean;     // 모든 세션 조회
}

/**
 * 역할별 기본 권한
 */
export const ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  [UserRole.CUSTOMER]: {
    canEdit: true,
    canAddDeletePages: true,
    canReplaceTemplate: true,
    canUnlockElements: false,
    canChangeStatus: false,
    canViewAllSessions: false,
  },
  [UserRole.MANAGER]: {
    canEdit: true,
    canAddDeletePages: true,
    canReplaceTemplate: true,
    canUnlockElements: true,
    canChangeStatus: true,
    canViewAllSessions: true,
  },
  [UserRole.ADMIN]: {
    canEdit: true,
    canAddDeletePages: true,
    canReplaceTemplate: true,
    canUnlockElements: true,
    canChangeStatus: true,
    canViewAllSessions: true,
  },
  // P1 멀티테넌시: 사이트 운영자. 기능 권한은 ADMIN/MANAGER 급이되, 접근 범위(site)는
  // TenantGuard 가 user_site_roles 로 스코핑한다(여기 권한 맵은 '무엇을 할 수 있나'만 정의).
  [UserRole.SITE_ADMIN]: {
    canEdit: true,
    canAddDeletePages: true,
    canReplaceTemplate: true,
    canUnlockElements: true,
    canChangeStatus: true,
    canViewAllSessions: true,
  },
  [UserRole.SITE_MANAGER]: {
    canEdit: true,
    canAddDeletePages: true,
    canReplaceTemplate: true,
    canUnlockElements: true,
    canChangeStatus: true,
    canViewAllSessions: true,
  },
  [UserRole.SUPER_ADMIN]: {
    canEdit: true,
    canAddDeletePages: true,
    canReplaceTemplate: true,
    canUnlockElements: true,
    canChangeStatus: true,
    canViewAllSessions: true,
  },
};

// ============================================================================
// Editor Mode (에디터 모드)
// ============================================================================

/**
 * 에디터 모드
 * - single: 개별 캔버스 편집 (기존)
 * - book: 표지 스프레드 편집 (신규)
 */
export enum EditorMode {
  SINGLE = 'single',
  BOOK = 'book',
}

// ============================================================================
// Editor Menus (좌측 도구 메뉴 — 템플릿셋별 노출 제어)
// ============================================================================

/**
 * 에디터 좌측 ToolBar 메뉴 키.
 * - 새 도구를 추가할 때 이 enum + EDITOR_MENU_DEFS 에만 등록하면
 *   admin/editor 양쪽이 자동으로 인지한다.
 */
export type EditorMenuKey =
  | 'UPLOAD'
  | 'CLIPPING'
  | 'TEMPLATE'
  | 'IMAGE'
  | 'TEXT'
  | 'SHAPE'
  | 'BACKGROUND'
  | 'FRAME'
  | 'SMART_CODE'
  | 'EDIT'
  | 'AI';

/**
 * 메뉴 메타정보. admin 의 토글 UI 에서 그대로 사용.
 * - `key`: ToolBar 가 렌더하는 메뉴 type 과 일치 (대소문자 구분)
 * - `label`: 사용자 노출 라벨 (Korean)
 * - `description`: admin 도움말
 * - `defaultEnabled`: 신규 템플릿셋의 디폴트 (모두 true — 명시적 비활성만 enabledMenus 에서 빠짐)
 * - `requiresFlag`: 빌드 타임 feature flag 가 필요한 경우 (예: AI, OpenCV)
 */
export interface EditorMenuDef {
  key: EditorMenuKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
  requiresFlag?: 'IMAGE_PROCESSING' | 'TEMPLATE' | 'FRAME' | 'SMART_CODE' | 'AI' | 'UPLOAD';
}

/**
 * 메뉴 정의 — admin 토글 UI / editor 필터링이 공통으로 참조하는 단일 소스.
 * 새 도구가 추가되면 여기에만 항목을 추가하면 admin 체크박스가 자동 생성된다.
 */
export const EDITOR_MENU_DEFS: EditorMenuDef[] = [
  { key: 'UPLOAD', label: '업로드', description: '사용자 이미지 업로드 (PDF/AI/EPS 포함)', defaultEnabled: true, requiresFlag: 'UPLOAD' },
  { key: 'CLIPPING', label: '모양컷', description: 'OpenCV 기반 모양 클리핑', defaultEnabled: true, requiresFlag: 'IMAGE_PROCESSING' },
  { key: 'TEMPLATE', label: '템플릿', description: '템플릿셋 / 낱장 템플릿 교체', defaultEnabled: true, requiresFlag: 'TEMPLATE' },
  { key: 'IMAGE', label: '이미지', description: '라이브러리 이미지 추가', defaultEnabled: true },
  { key: 'TEXT', label: '텍스트', description: '텍스트 추가 + 추천 스타일', defaultEnabled: true },
  { key: 'SHAPE', label: '요소', description: '도형/일러스트 추가', defaultEnabled: true },
  { key: 'BACKGROUND', label: '배경', description: '배경색 / 배경 이미지', defaultEnabled: true },
  { key: 'FRAME', label: '프레임', description: '사진틀 (이미지 마스킹)', defaultEnabled: true, requiresFlag: 'FRAME' },
  { key: 'SMART_CODE', label: 'QR/바코드', description: 'QR 코드 / 바코드 생성', defaultEnabled: true, requiresFlag: 'SMART_CODE' },
  { key: 'EDIT', label: '편집도구', description: '이미지 편집 (배경 제거 등 OpenCV)', defaultEnabled: true, requiresFlag: 'IMAGE_PROCESSING' },
  { key: 'AI', label: 'AI', description: 'AI 추천 / 생성 패널', defaultEnabled: true, requiresFlag: 'AI' },
];

/**
 * 모든 메뉴 키 배열 (편의용).
 */
export const ALL_EDITOR_MENU_KEYS: EditorMenuKey[] = EDITOR_MENU_DEFS.map((d) => d.key);

/**
 * `enabledMenus` 가 null/undefined 이면 "모두 노출"로 해석.
 * 빈 배열은 "어떤 메뉴도 노출 안 함" — 극단적 케이스(예: 업로드만 별도 옵션) 를 위해 허용.
 */
export function resolveEnabledMenus(
  enabledMenus: EditorMenuKey[] | null | undefined
): EditorMenuKey[] {
  return enabledMenus ?? ALL_EDITOR_MENU_KEYS;
}

/**
 * 특정 메뉴가 템플릿셋 설정에서 활성인지 판정.
 */
export function isMenuEnabled(
  enabledMenus: EditorMenuKey[] | null | undefined,
  key: EditorMenuKey
): boolean {
  if (enabledMenus == null) return true;
  return enabledMenus.includes(key);
}

// ============================================================================
// Spread Editor (스프레드 편집)
// ============================================================================

/**
 * 스프레드 영역 위치
 * 좌→우 순서: back-wing, back-cover, spine, front-cover, front-wing
 */
export type SpreadRegionPosition =
  | 'back-wing'
  | 'back-cover'
  | 'spine'
  | 'front-cover'
  | 'front-wing';

/**
 * 객체 앵커 메타데이터
 * - region: 영역 기준 정규화 좌표 (0~1, 범위 외 허용 -1.0~2.0)
 * - canvas: 캔버스 절대 좌표 (자유 객체용)
 * 기준점: 항상 객체의 중심점(center)
 */
export type ObjectAnchor =
  | { kind: 'region'; xNorm: number; yNorm: number }
  | { kind: 'canvas'; x: number; y: number };

/**
 * 스프레드 객체 메타 (Fabric object.meta에 저장)
 */
export interface SpreadObjectMeta {
  regionRef: SpreadRegionPosition | null;
  primaryRegionHint: SpreadRegionPosition | null;
  anchor: ObjectAnchor;
  /**
   * flat-spine 변환(conversionMode='flat-spine') 3분할 아트워크 식별.
   * - 'spine': 책등 중심 3배폭 크롭 — resizeSpine 재배치에서 무이동·무스케일(SpreadPlugin 가드)
   * - 'back' | 'front': 표지 크롭 — region anchor 로 평행이동
   */
  flatArtwork?: 'spine' | 'back' | 'front';
}

/**
 * 시스템 객체 식별 메타 (플러그인 생성 오브젝트에만 부여)
 */
export type SystemObjectType =
  | 'workspace'
  | 'cutBorder'
  | 'safeBorder'
  | 'spreadGuide'
  | 'dimensionLabel';

/**
 * 스프레드 스펙 (최소 입력 - 레이아웃 계산 입력)
 */
export interface SpreadSpec {
  coverWidthMm: number;
  coverHeightMm: number;
  spineWidthMm: number;
  wingEnabled: boolean;
  wingWidthMm: number;
  cutSizeMm: number;
  safeSizeMm: number;
  dpi: number;
  /**
   * D-4 (2026-07-06): 싸바리(하드커버 보드 wrap) geometry — optional additive, 기존 BOOK 비파괴.
   * 화면 레이아웃(computeSpreadDimensions/SpreadLayoutEngine)에는 **관여하지 않고**,
   * 출력(PDF) 사이즈 계산(computeSpreadOutputDimensions)에만 사용된다.
   */
  caseBind?: CaseBindSpec;
}

/**
 * 스프레드 영역 (레이아웃 계산 결과)
 */
export interface SpreadRegion {
  type: 'wing' | 'cover' | 'spine';
  position: SpreadRegionPosition;
  x: number;           // workspace px
  width: number;        // workspace px
  height: number;       // workspace px
  widthMm: number;
  heightMm: number;
  label: string;
}

/**
 * 가이드라인 스펙
 */
export interface GuideLineSpec {
  x: number;            // workspace px
  y1: number;
  y2: number;
  type: 'region-border';
}

/**
 * 치수 라벨 스펙
 */
export interface DimensionLabel {
  x: number;            // workspace px (영역 중앙)
  y: number;            // workspace px (상단)
  text: string;         // 예: "210mm"
  regionPosition: SpreadRegionPosition;
}

/**
 * 스프레드 레이아웃 (계산 결과)
 */
export interface SpreadLayout {
  regions: SpreadRegion[];
  guides: GuideLineSpec[];
  labels: DimensionLabel[];
  totalWidthPx: number;
  totalHeightPx: number;
  totalWidthMm: number;
  totalHeightMm: number;
}

/**
 * 스프레드 설정 (저장용)
 */
/**
 * 템플릿 변환 모드 (IDML 가져오기 유형 3종)
 * - 'full'        : 벡터 변환 — 모든 객체 개별 편집 가능 (현행 vector 모드. 미존재 시 기본값)
 * - 'flat-spread' : 전폭 300dpi PNG 1장(id='idml-artwork') + 텍스트 오버레이.
 *                   책등 고정 — 편집기에서 책등 가변(resizeSpine) 차단 대상.
 * - 'flat-spine'  : 아트워크 3분할 PNG(spine/back/front-artwork) + 텍스트 오버레이.
 *                   spine PNG 는 책등 중심 3배폭(canvas anchor, scene x=0), back/front 는 region anchor
 *                   → 책등 가변 허용(대칭 레이아웃 전제: spine 중심 불변, back/front 는 region 추종).
 */
export type SpreadConversionMode = 'full' | 'flat-spread' | 'flat-spine';

/**
 * SpreadConfig.version 현재값.
 * - 1: 초기 (표지 스프레드 + 포토북 내지 regionScope/innerSpec)
 * - 2: D-4 caseBind(싸바리)·출력 사이즈 이중경계 도입 (2026-07-06)
 * 소비처는 version 으로 게이팅하지 않는다(형상 세대 추적용 — 미존재 시 1 간주).
 */
export const SPREAD_CONFIG_VERSION = 2;

export interface SpreadConfig {
  version: number;        // SPREAD_CONFIG_VERSION 참조 (1=초기, 2=caseBind/출력 사이즈)
  /**
   * 표지 스프레드 스펙(front/spine/back). regionScope==='cover'(기본)에서 필수.
   * 포토북 내지(regionScope==='inner')는 spec 대신 innerSpec 을 사용하므로 생략 가능.
   * (기존 읽기 경로는 모두 `spreadConfig?.spec` truthy 가드라 선택화는 비파괴.)
   */
  spec?: SpreadSpec;
  regions: SpreadRegion[];
  totalWidthMm: number;
  totalHeightMm: number;
  /** IDML 가져오기 변환 모드. JSON 필드라 마이그레이션 불필요. 미존재 시 'full' 간주. */
  conversionMode?: SpreadConversionMode;
  /**
   * 포토북(O-2): 이 스프레드가 표지인지 내지(2-up 펼침면)인지. 미존재 시 'cover'(기존 호환).
   * 'inner' 면 spec 대신 innerSpec 으로 좌/우 면 레이아웃을 계산한다(computeInnerSpreadLayout).
   */
  regionScope?: 'cover' | 'inner';
  /** 포토북 내지 펼침면(2-up) 스펙. regionScope==='inner' 일 때 사용. */
  innerSpec?: SpreadInnerSpec;
}

// ============================================================================
// 포토북 펼침면 내지(2-up) 모델 (O-2, 2026-06-24)
// — 표지 스프레드(wing/cover/spine)와 **별개**의 좌/우 면 + 거터 모델.
//   좌표는 중앙원점@150dpi 규약(content=trim, bleed 는 WorkspacePlugin 이 별도 처리) — 표지와 동일.
// ============================================================================

/**
 * 펼침면 내지(2-up) 스펙 — 레이아웃 계산 입력.
 * 한 면(page) = pageWidthMm × pageHeightMm. 펼침면 trim = pageWidthMm*2 × pageHeightMm.
 * gutterMm = 중앙(제본부) 안전 밴드 폭(제본 손실 회피). cutSizeMm = 블리드(사방).
 */
export interface SpreadInnerSpec {
  pageWidthMm: number;
  pageHeightMm: number;
  gutterMm: number;
  cutSizeMm: number;
  safeSizeMm: number;
  dpi: number;
}

export type SpreadInnerRegionPosition = 'left-page' | 'right-page';

/** 펼침면 내지 영역(좌/우 면) — 레이아웃 결과(workspace px, trim 기준 0=좌). */
export interface SpreadInnerRegion {
  position: SpreadInnerRegionPosition;
  x: number;          // workspace px (0 = trim 좌단)
  width: number;      // px
  height: number;     // px
  widthMm: number;
  heightMm: number;
  label: string;
}

/** 펼침면 내지 레이아웃(계산 결과). 표지 SpreadLayout 과 형태는 유사하나 별개 타입. */
export interface SpreadInnerLayout {
  regions: SpreadInnerRegion[];   // [left-page, right-page]
  gutterGuide: GuideLineSpec;     // 중앙 제본 경계선(좌/우 면 경계)
  gutterBandPx: number;           // 거터 안전 밴드 폭(px) — 중앙 ±band/2 영역은 콘텐츠 회피
  totalWidthPx: number;
  totalHeightPx: number;
  totalWidthMm: number;           // pageWidthMm*2 (trim, bleed 제외)
  totalHeightMm: number;          // pageHeightMm
}

/** 페이지가 펼침면 페어의 어느 면/페어인지(재정렬·삭제·출력 정합용). */
export interface SpreadPairMeta {
  /** 펼침면 페어 식별자(좌우 두 면이 같은 값) */
  pairId: string;
  /** 논리 페이지 번호 — 좌면(verso)/우면(recto) */
  leftPageNo: number;
  rightPageNo: number;
}

/**
 * 스프레드 리사이즈 이벤트
 */
export interface SpreadResizeEvent {
  oldSpineWidth: number;    // mm
  newSpineWidth: number;    // mm
  oldLayout: SpreadLayout;
  newLayout: SpreadLayout;
}

/**
 * 객체 재배치 결과
 */
export interface RepositionResult {
  x: number;
  y: number;
  scaleX?: number;
  scaleY?: number;
  regionRef: SpreadRegionPosition | null;
  anchor: ObjectAnchor;
}

/**
 * RegionRef 판정 결과
 */
export interface RegionRefResult {
  regionRef: SpreadRegionPosition | null;
  primaryRegionHint: SpreadRegionPosition | null;
  anchor: ObjectAnchor;
}

// ============================================================================
// Spread Session Snapshot (세션 스냅샷)
// ============================================================================

/**
 * 책등 공식 버전. editor 저장·api/worker 검증 공용 단일 상수.
 * 책등 계산 공식(calculateSpineWidth)이 바뀌면 bump 한다. (formulaVersion 추적용)
 */
export const SPINE_FORMULA_VERSION = '1.0' as const;

/**
 * 책등 스냅샷 (EditSession.metadata.spine)
 */
export interface SpineSnapshot {
  pageCount: number;
  paperType: string;
  bindingType: string;
  spineWidthMm: number;
  formulaVersion: string;
  /**
   * spineWidthMm 출처. 'formula'=책등공식 계산값과 일치, 'manual'=사용자/수동 조정으로 공식값과 불일치.
   * (옵셔널 — 검증자는 위 5필드만 truthy 확인하므로 하위호환 유지. hard 승격 시 정책 판단용)
   */
  spineWidthSource?: 'formula' | 'manual';
}

/**
 * 스프레드 스냅샷 (EditSession.metadata.spread)
 */
export interface SpreadSnapshot {
  spec: SpreadSpec;
  totalWidthMm: number;
  totalHeightMm: number;
  dpi: number;
  /**
   * D-4 (2026-07-06, 트랙 간 동결 인터페이스 ①): 싸바리 wrap 포함 **출력(PDF) 사이즈** mm.
   * caseBind 가 설정된 세션에만 기록(additive) — 미설정 세션은 필드 자체 생략(기존 스냅샷 불변).
   * 워커 cover MediaBox 검증 기대치는 output 우선·total 폴백으로 확장 가능.
   */
  outputWidthMm?: number;
  outputHeightMm?: number;
}

/**
 * 스프레드 스냅샷 검증 결과 (EditSession.metadata.spreadValidation)
 * P0-2: 완료 시 서버가 스냅샷 무결성을 SOFT(경고/기록) 또는 HARD(차단)로 검증한 결과.
 */
export interface SpreadValidationResult {
  ok: boolean;
  checkedAt: string;                                          // ISO timestamp
  gate: 'session-mode' | 'metadata-spread';                  // 어떤 게이트로 검증 진입했는지
  mismatches: string[];                                       // 누락/불일치 사유 코드·메시지
  mode: 'soft' | 'hard';                                      // 적용 검증 모드
}

/**
 * 편집 세션 메타데이터
 */
export interface EditSessionMetadata {
  spine?: SpineSnapshot;
  spread?: SpreadSnapshot;
  spreadValidation?: SpreadValidationResult;
  /**
   * 내지 PDF 표시전용 가이드 (2026-06-07).
   * 워커 RENDER_PAGES 잡이 생성한 페이지 이미지 URL 목록.
   * 편집기는 underlay 모드에서 이 URL들을 잠금 가이드 배경으로 로드.
   */
  contentPdfGuide?: ContentPdfGuide;
  /**
   * D1 외부 사진 주입 (2026-06-12, EDITOR.md §20.1).
   * 호스트(예: ShareSnap 공유방)가 세션 생성/PATCH 시 주입하는 사진 목록.
   * 목록이 있으면 편집기 이미지 패널에 "공유방 사진" 탭이 조건부 렌더된다.
   * url 은 인쇄용 리사이즈본(긴변 3000~4000px 권장, 만료형 signed URL 금지).
   */
  externalPhotos?: ExternalPhoto[];
}

/**
 * 외부 주입 사진 1장 (D1).
 */
export interface ExternalPhoto {
  /** 인쇄용 이미지 URL (편집기 캔버스에 로드되는 원본 — 곧 인쇄 품질) */
  url: string;
  /** 표시명 */
  name?: string;
  /** 패널 그리드용 썸네일(~300px). 없으면 url 사용 */
  thumbnailUrl?: string;
  /** 올린 사람 표시명 (정렬/필터용, 선택) */
  uploaderName?: string;
  /** 업로드 시각 ISO (정렬용, 선택) */
  uploadedAt?: string;
  /**
   * 포토북 자동편집(Phase 2): EXIF 메타. 호스트가 주입하거나 편집기가 exifr 로 파싱해 채운다.
   * 없을 수 있음(스캔/구형/프라이버시) → 정렬 폴백 체인(takenAt→uploadedAt→name)으로 처리.
   */
  takenAt?: string;            // EXIF DateTimeOriginal ISO (날짜순 정렬 1차 기준)
  gps?: { lat: number; lng: number }; // EXIF GPS (장소별=군집 기준, 없으면 날짜로 폴백)
  exifParsed?: boolean;        // EXIF 파싱 시도 완료 플래그(중복 파싱 방지)
}

/**
 * 포토북 자동편집 정렬 기준 (Phase 2).
 * - 'date'    : 촬영일시(DateTimeOriginal) 오름차순 — **기본/1차 기준**(거의 항상 존재, 시간순 이야기).
 * - 'filename': 파일명 자연 정렬.
 * - 'location': GPS 근접 군집 → 군집을 최소 촬영시각순, 군집 내부는 시간순. GPS 없는 사진은 날짜로 폴백.
 * - 'random'  : 셔플(프레임 매칭은 레이아웃 엔진이 별도 처리).
 * ⚠️ GPS 는 '유일 기준'이 아니라 'location' 모드 한정 + 군집 필요 + 폴백 동반.
 */
export type PhotoSortMode = 'date' | 'filename' | 'location' | 'random';

/**
 * 내지 PDF 표시전용 가이드 결과 (RENDER_PAGES 잡 산출).
 */
export interface ContentPdfGuide {
  /** 가이드 출처 PDF 파일 ID (불일치 감지용) */
  sourceFileId: string;
  /** 래스터 해상도(dpi) */
  resolution: number;
  /** 페이지 순서대로의 이미지 상대 URL ('/storage/...') */
  pageImageUrls: string[];
  /** 생성 시각 ISO */
  renderedAt: string;
}

// ============================================================================
// Spread Synthesis (스프레드 PDF 합성)
// ============================================================================

/**
 * Spread Synthesis Job 옵션
 */
export interface SpreadSynthesisOptions {
  mode: 'spread';
  outputFormat: 'separate';
  alsoGenerateMerged?: boolean;
}

/**
 * Spread Synthesis Job Data (Worker Queue Payload)
 */
export interface SpreadSynthesisJobData {
  jobId: string;
  mode: 'spread';
  sessionId: string;
  spreadPdfFileId: string;
  contentPdfFileIds: string[];
  totalExpectedPages: number;
  outputFormat: 'separate';
  alsoGenerateMerged?: boolean;
  callbackUrl?: string;
}

/**
 * Spread Synthesis 로컬 결과
 */
export interface SpreadSynthesisLocalResult {
  success: boolean;
  coverPath: string;
  contentPath: string;
  mergedPath?: string;
  coverPageCount: number;
  contentPageCount: number;
}

/**
 * Spread Synthesis 웹훅 페이로드
 */
export interface SpreadSynthesisWebhookPayload {
  event: 'synthesis.completed' | 'synthesis.failed';
  jobId: string;
  orderId?: string;
  status: 'completed' | 'failed';
  outputFileUrl: string | null;  // merged가 없으면 null (미포함이 아닌 null)
  outputFiles: OutputFile[];     // 항상 cover/content 2개
  outputFormat: 'separate';
  spreadMode: true;
  queueJobId?: string | number;
  errorMessage?: string;
  timestamp: string;
}

// ============================================================================
// Partner API v1 (Stage 1 — docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §3)
// ============================================================================

/**
 * Partner API v1 에러 코드 카탈로그 (설계서 §3.3 — 29종).
 *
 * 계약 원칙: 파트너 분기는 errorCode(와 errors[].code)로만 한다.
 * message 문자열 파싱 금지 — 메시지는 예고 없이 개선될 수 있다.
 *
 * additive-only 성장: 코드 추가는 허용, 기존 코드의 의미 변경·삭제·
 * HTTP status 변경은 v1 내에서 금지(변경 필요 시 v2).
 */
export enum ErrV1 {
  // 공통 (8)
  ERR_UNAUTHORIZED = 'ERR_UNAUTHORIZED', // 401
  ERR_FORBIDDEN = 'ERR_FORBIDDEN', // 403
  ERR_ENV_MISMATCH = 'ERR_ENV_MISMATCH', // 403
  ERR_NOT_FOUND = 'ERR_NOT_FOUND', // 404
  ERR_VALIDATION_FAILED = 'ERR_VALIDATION_FAILED', // 400
  ERR_RATE_LIMITED = 'ERR_RATE_LIMITED', // 429 (+Retry-After)
  ERR_INTERNAL = 'ERR_INTERNAL', // 500
  ERR_SERVICE_UNAVAILABLE = 'ERR_SERVICE_UNAVAILABLE', // 503

  // 멱등성 (2) — 설계서 §4
  ERR_IDEMPOTENCY_KEY_MISMATCH = 'ERR_IDEMPOTENCY_KEY_MISMATCH', // 422 동일 키+다른 body hash
  ERR_IDEMPOTENCY_IN_PROGRESS = 'ERR_IDEMPOTENCY_IN_PROGRESS', // 409 동일 키 처리 중

  // 업로드/파일 (4)
  ERR_FILE_TOO_LARGE = 'ERR_FILE_TOO_LARGE', // 413
  ERR_UNSUPPORTED_CONTENT_TYPE = 'ERR_UNSUPPORTED_CONTENT_TYPE', // 415
  ERR_STORAGE_NOT_S3 = 'ERR_STORAGE_NOT_S3', // 503 (동결 문자열 STORAGE_NOT_S3 와 별개 표면)
  ERR_FILE_NOT_READY = 'ERR_FILE_NOT_READY', // 409

  // BookSpecs (2)
  ERR_BOOK_SPEC_NOT_FOUND = 'ERR_BOOK_SPEC_NOT_FOUND', // 404
  ERR_PAGE_COUNT_OUT_OF_RANGE = 'ERR_PAGE_COUNT_OUT_OF_RANGE', // 422

  // Books/자산/최종화 (8)
  ERR_BOOK_NOT_DRAFT = 'ERR_BOOK_NOT_DRAFT', // 409
  ERR_ASSET_ALREADY_EXISTS = 'ERR_ASSET_ALREADY_EXISTS', // 409
  ERR_ASSET_NOT_FOUND = 'ERR_ASSET_NOT_FOUND', // 404
  ERR_ASSET_INCOMPATIBLE = 'ERR_ASSET_INCOMPATIBLE', // 422
  ERR_ASSETS_INCOMPLETE = 'ERR_ASSETS_INCOMPLETE', // 422
  ERR_FINALIZATION_IN_PROGRESS = 'ERR_FINALIZATION_IN_PROGRESS', // 409
  ERR_PDF_VALIDATION_FAILED = 'ERR_PDF_VALIDATION_FAILED', // 422
  ERR_SESSION_NOT_PROMOTABLE = 'ERR_SESSION_NOT_PROMOTABLE', // 409

  // Webhooks (3)
  ERR_WEBHOOK_CONFIG_NOT_FOUND = 'ERR_WEBHOOK_CONFIG_NOT_FOUND', // 404
  ERR_WEBHOOK_URL_FORBIDDEN = 'ERR_WEBHOOK_URL_FORBIDDEN', // 422
  ERR_DELIVERY_NOT_RETRYABLE = 'ERR_DELIVERY_NOT_RETRYABLE', // 409

  // [오너 게이트] Orders/Credits (2) — Stage 6
  ERR_ORDER_NOT_CANCELLABLE = 'ERR_ORDER_NOT_CANCELLABLE', // 409
  ERR_INSUFFICIENT_CREDIT = 'ERR_INSUFFICIENT_CREDIT', // 402
}

/** v1 목록 응답 pagination 메타 (설계서 §5.1) */
export interface PartnerV1Pagination {
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}

/** v1 성공 봉투 — 필드 4종 고정 (설계서 §3.1) */
export interface PartnerV1SuccessEnvelope<T> {
  success: true;
  message: string;
  data: T;
  pagination: PartnerV1Pagination | null;
}

/** v1 에러 봉투의 errors[] 도메인 상세 항목 */
export interface PartnerV1ErrorItem {
  code: string;
  message: string;
}

/** v1 에러 봉투 — 필드 6종 고정 (설계서 §3.2) */
export interface PartnerV1ErrorEnvelope {
  success: false;
  errorCode: ErrV1;
  message: string;
  errors: PartnerV1ErrorItem[];
  fieldErrors: Record<string, string[]> | null;
  requestId: string;
}
