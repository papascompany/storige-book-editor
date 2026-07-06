import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
  Index,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Category } from './category.entity';
import { Template } from './template.entity';
import type { ProductSpecs, TemplateSetType, TemplateRef, EditorMode, EditorMenuKey, PdfOutputMode, ColorOutputMode, PhotobookPricing } from '@storige/types';

/**
 * D-4 커버 3종 시드 코드 (2026-07-06, C-4 Track 3).
 * ⚠️ 고정 enum 금지(오너 결정 D-4 — "커버 종류는 상품 구성에 따라 추가될 수 있다").
 *    컬럼은 varchar 자유 코드이며, 이 상수는 admin 셀렉트 시드/문서화 용도다.
 * ⚠️ packages/types 는 Track 1 소유 — 통합 시 이 로컬 선언을 Track 1 공유 타입으로 치환.
 */
export const COVER_TYPE_SEED_CODES = [
  /** 하드커버(싸바리) — coverConfig.caseBind 활성 */
  'hardcover_wrap',
  /** 책등가변 일반커버(소프트커버) — 현행 SpreadSpec(책등 가변) 경로 */
  'softcover_variable_spine',
  /** 기성커버 — 기존 coverEditable=false + coverPreviewImage 경로에 매핑 */
  'ready_made',
] as const;

/**
 * 싸바리(caseBind) geometry — 하드커버 wrap 산출용 3필드 (mm).
 * 화면 = trim 기준 뷰 / 출력 = wrap 포함 사이즈 (D-4).
 */
export interface CoverCaseBindConfig {
  /** 합지(보드) 두께 mm */
  boardThicknessMm: number;
  /** 안쪽으로 접어 넘기는 여분(turn-in) mm */
  turnInMm: number;
  /** trim 대비 사방으로 추가되는 wrap 여분 mm */
  wrapMarginMm: number;
}

/**
 * 커버 종류별 부가 설정 JSON (additive nullable — NULL=미사용, 기존 셋 비파괴).
 */
export interface TemplateSetCoverConfig {
  /** 하드커버(싸바리) geometry — coverType='hardcover_wrap' 계열에서 사용 */
  caseBind?: CoverCaseBindConfig;
  /** 기성커버 참조(옵션) — 정본은 기존 coverPreviewImage 필드, 여기는 보조 참조 */
  readyMade?: { previewImageUrl?: string | null };
}

/**
 * 템플릿셋 타입 enum (DB용)
 */
export enum TemplateSetTypeEnum {
  BOOK = 'book',
  LEAFLET = 'leaflet',
  PHOTOBOOK = 'photobook',
}

@Entity('template_sets')
@Index('idx_template_set_type', ['type'])
@Index('idx_template_set_deleted', ['isDeleted'])
export class TemplateSet {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  /**
   * 템플릿셋 타입: book(책자), leaflet(리플렛)
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: TemplateSetTypeEnum.BOOK,
  })
  type: TemplateSetType;

  /**
   * 판형 - 가로 (mm)
   */
  @Column({ type: 'float', default: 210 })
  width: number;

  /**
   * 판형 - 세로 (mm)
   */
  @Column({ type: 'float', default: 297 })
  height: number;

  /**
   * 내지 추가 가능 여부
   */
  @Column({ name: 'can_add_page', type: 'boolean', default: true })
  canAddPage: boolean;

  /**
   * 내지 수량 범위 (예: [10, 20, 30, 40])
   */
  @Column({ name: 'page_count_range', type: 'json', default: '[]' })
  pageCountRange: number[];

  /**
   * 템플릿 구성 (순서 포함)
   * TemplateRef[] 형태로 저장
   */
  @Column({ type: 'json', default: '[]' })
  templates: TemplateRef[];

  /**
   * 에디터 모드: single(개별 캔버스 편집) | book(스프레드 편집)
   */
  @Column({ name: 'editor_mode', type: 'varchar', length: 20, default: 'single' })
  editorMode: EditorMode;

  /**
   * 에디터 좌측 도구 메뉴 노출 화이트리스트.
   * - null: 모든 메뉴 노출 (legacy/기본값)
   * - 배열: 배열에 포함된 키만 노출 (예: ['UPLOAD','TEXT','IMAGE'])
   * - 빈 배열 []: 모든 도구 메뉴 숨김
   *
   * 키 정의는 `@storige/types` 의 `EditorMenuKey` / `EDITOR_MENU_DEFS` 참조.
   * Admin 의 템플릿셋 편집 화면에서 토글로 설정.
   */
  @Column({ name: 'enabled_menus', type: 'json', nullable: true })
  enabledMenus: EditorMenuKey[] | null;

  // ─────────────────────────────────────────────────────
  // 인쇄 워크플로우 v1 Phase 2 (2026-05-19)
  // 면지 / 표지 편집 / 레더 커버 미리보기 필드.
  // 마이그레이션: apps/api/migrations/20260519_v1_phase2_workflow_schema.sql
  // ─────────────────────────────────────────────────────

  /**
   * 면지(EndPaper) 구성 — Phase 2.
   * shape: { frontCount, backCount, frontEditable, backEditable }.
   * null: 면지 없음 (legacy/기본).
   */
  @Column({ name: 'endpaper_config', type: 'json', nullable: true })
  endpaperConfig: {
    frontCount: number;
    backCount: number;
    frontEditable: boolean;
    backEditable: boolean;
  } | null;

  /**
   * 표지 편집 가능 여부 — Phase 2.
   * 기본 true (일반 책 표지). 레더 커버 / 화보집은 false.
   */
  @Column({ name: 'cover_editable', type: 'boolean', default: true })
  coverEditable: boolean;

  /**
   * 레더 커버 / 화보집용 표지 미리보기 이미지 storage URL — Phase 2.
   * 결정 3-5: 별도 필드. `coverEditable=false` 일 때만 의미 있음.
   */
  @Column({ name: 'cover_preview_image', type: 'varchar', length: 500, nullable: true })
  coverPreviewImage: string | null;

  /**
   * 내지 PDF 첨부 파일 편집 가능 여부 — 표시전용 임포지션 (2026-06-08).
   * true(기본): underlay 가이드 위 편집 허용. false: 가이드 표시·편집 차단 + 첫페이지 레이블.
   * 어느 쪽이든 최종 내지 인쇄는 첨부 원본 PDF 그대로(편집 미반영).
   */
  @Column({ name: 'content_pdf_editable', type: 'boolean', default: true })
  contentPdfEditable: boolean;

  /**
   * PDF 출력 모드 (2026-06-09) — 'single'(단면 1p) | 'duplex-merged'(양면 1파일) |
   * 'duplex-split'(앞/뒤 세트별 개별 PDF). 단일/낱장 상품 출력에 적용.
   */
  @Column({ name: 'pdf_output_mode', type: 'varchar', length: 20, default: 'duplex-merged' })
  pdfOutputMode: PdfOutputMode;

  /**
   * 색 처리 모드 (2026-06-09) — 'rgb'(유지, 기본) | 'cmyk'(출력 시 변환).
   * 워커 실제 변환은 인쇄출력 영향 → 별도(스테이징). 필드는 의도 저장.
   */
  @Column({ name: 'color_mode', type: 'varchar', length: 10, default: 'rgb' })
  colorMode: ColorOutputMode;

  // ─────────────────────────────────────────────────────
  // 블리드 / 재단선 / 사이즈 검증 허용오차 (2026-06-10)
  // 마이그레이션: apps/api/migrations/20260610_add_bleed_cropmark_tolerance.sql
  // ⚠️ P1 단계 = '필드 저장 + 전달'만. 워커의 실제 검증/변환 동작 변경은 P4에서.
  // ─────────────────────────────────────────────────────

  /**
   * 사방(per-edge) 블리드 mm (2026-06-10). 작업사이즈 = 재단 + bleedMm*2.
   * 0이면 블리드 없음. 기본 3.
   */
  @Column({ name: 'bleed_mm', type: 'float', default: 3 })
  bleedMm: number;

  /**
   * 재단선(crop mark) 마커 표기 ON/OFF 토글 (2026-06-10). 블리드와 별개 명시 스위치.
   * 기본 false(0).
   */
  @Column({ name: 'crop_mark_enabled', type: 'boolean', default: false })
  cropMarkEnabled: boolean;

  /**
   * 고객 업로드 PDF 사이즈 검증 허용오차 mm (2026-06-10). 기본 0.2.
   */
  @Column({ name: 'size_tolerance_mm', type: 'float', default: 0.2 })
  sizeToleranceMm: number;

  // ─────────────────────────────────────────────────────
  // 포토북 페이지 가변 가격 메타 (2026-06-24, Phase 2)
  // 마이그레이션: apps/api/migrations/20260624_add_template_set_pricing.sql
  // ⚠️ storige 는 가격을 계산하지 않는다 — 메타 저장 + 편집완료 시 pageCount/pricing emit 만.
  //    실제 가/감 가격 계산은 파트너(bookmoa-mobile 등) 장바구니 책임.
  // ─────────────────────────────────────────────────────

  /**
   * PHOTOBOOK 페이지 가변 가격 메타 (2026-06-24, additive nullable=비파괴).
   * shape: { includedPages, minPages, pageStep, perPageUnit }.
   * null: 가변 가격 미사용 (BOOK/LEAFLET 등 기존 동작 비파괴).
   */
  @Column({ name: 'pricing', type: 'json', nullable: true })
  pricing: PhotobookPricing | null;

  // ─────────────────────────────────────────────────────
  // D-4 커버 3종 메타 (2026-07-06, C-4 Track 3)
  // 마이그레이션: apps/api/migrations/20260706_add_template_set_cover_type.sql
  // ⚠️ 편집 UX 는 coverType 으로 게이팅하지 않는다(공유 UX 원칙). 출력/emit 메타 전용.
  // ─────────────────────────────────────────────────────

  /**
   * 커버 종류 코드 (additive nullable=비파괴).
   * 시드 3종: 'hardcover_wrap' | 'softcover_variable_spine' | 'ready_made' — COVER_TYPE_SEED_CODES.
   * 고정 enum 금지(D-4) — 자유 코드 확장 가능. NULL=미사용(기존 셋 동작 무변화).
   */
  @Column({ name: 'cover_type', type: 'varchar', length: 50, nullable: true })
  coverType: string | null;

  /**
   * 커버 종류별 설정 JSON (additive nullable=비파괴).
   * shape: { caseBind?: { boardThicknessMm, turnInMm, wrapMarginMm }, readyMade?: { previewImageUrl } }.
   * NULL=미사용.
   */
  @Column({ name: 'cover_config', type: 'json', nullable: true })
  coverConfig: TemplateSetCoverConfig | null;

  /**
   * ④ 연결된 라이브러리 카테고리 ID (2026-06-09) — 컬럼 아님(transient).
   * 조인 테이블 template_set_library_categories 에서 서비스가 populate. 빈/없음=전역 노출.
   */
  libraryCategoryIds?: string[];

  /**
   * 소프트 삭제 플래그
   */
  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  // Legacy fields (하위 호환)
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'category_id', type: 'varchar', length: 36, nullable: true })
  categoryId: string | null;

  @Column({ name: 'product_specs', type: 'json', nullable: true })
  productSpecs: ProductSpecs | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // P2 멀티테넌시 (2026-06-17) — 소속 site. NULL = 시스템공유(hybrid). additive nullable(비파괴).
  // 조회 스코핑은 QueryScope(P2b)에서 적용. 인덱스는 마이그레이션 SQL에서 생성.
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @OneToMany(() => TemplateSetItem, (item) => item.templateSet)
  items: TemplateSetItem[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}

@Entity('template_set_items')
export class TemplateSetItem {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ name: 'template_set_id', type: 'varchar', length: 36 })
  templateSetId: string;

  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /**
   * 필수 페이지 여부
   */
  @Column({ type: 'boolean', default: false })
  required: boolean;

  // Relations
  @ManyToOne(() => TemplateSet, (set) => set.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_set_id' })
  templateSet: TemplateSet;

  @ManyToOne(() => Template, { nullable: true })
  @JoinColumn({ name: 'template_id' })
  template: Template;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
