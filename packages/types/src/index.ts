/**
 * @storige/types
 * Shared TypeScript types for Storige system
 */

// ============================================================================
// User & Authentication
// ============================================================================

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  CUSTOMER = 'CUSTOMER',
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
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
 */
export enum TemplateSetType {
  BOOK = 'book',
  LEAFLET = 'leaflet',
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
  result?: ValidationResult | ConversionResult | SynthesisResult;
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
}

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

export interface ValidationError {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  code: string;
  message: string;
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
 */
export interface OutputFile {
  type: 'cover' | 'content';
  url: string;
  pageCount?: number;
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
}

/**
 * 검증 완료 웹훅 페이로드
 * POST /worker-jobs/validate/external 의 callbackUrl로 전송
 */
export interface ValidationWebhookPayload {
  event: 'validation.completed' | 'validation.fixable' | 'validation.failed';
  jobId: string;
  /** 검증 대상 파일 타입 */
  fileType: 'cover' | 'content' | 'post_process';
  /** 연결된 주문 번호 */
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

  // 책등 폭 계산
  const spineWidth = (config.pageCount / 2) * paperThickness + bindingMargin;

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
export interface SpreadConfig {
  version: number;        // 1 (향후 계산식 변경 대비)
  spec: SpreadSpec;
  regions: SpreadRegion[];
  totalWidthMm: number;
  totalHeightMm: number;
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
}

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
