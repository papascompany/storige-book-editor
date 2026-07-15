import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * book_specs.spine_formula JSON shape — SpineService 파라미터 참조.
 *
 * 계산은 기존 SpineService.calculate() 를 그대로 재사용한다(중복 구현 금지).
 * - paperCode: paper_types.code (미지정 시 defaultPaperCode 폴백)
 * - bindingCode: binding_types.code (미지정 시 bindingType 컬럼 폴백 —
 *   book_specs.binding_type 은 binding_types.code canonical 어휘를 승계)
 * - customPaperThickness / customBindingMargin: CalculateSpineDto 의
 *   커스텀 계수와 1:1 매핑(지정 시 DB 계수 대신 사용)
 */
export interface BookSpecSpineFormula {
  paperCode?: string;
  bindingCode?: string;
  customPaperThickness?: number;
  customBindingMargin?: number;
}

/**
 * 판형 마스터 엔티티 (Partner API v1 Stage 1 — 2026-07-15)
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.3
 * 마이그레이션: apps/api/migrations/20260715_add_book_specs.sql
 *
 * - 외부 대면 판형 마스터 — template_sets 자유입력 width/height ·
 *   products/spine(paper/binding) · format_presets 에 분산된 판형 정보의 정규화.
 * - uid('bs_...')만 외부 노출, 내부 UUID(id)는 비노출 (설계서 §2.0 접두 체계).
 * - 초기 시드는 수집 스크립트(cli/collect-book-specs.cli.ts) dry-run 산출을
 *   오너 검토 후 수동 적용 (설계서 §9-6 — 자동 시드 금지).
 * - 하드 삭제 금지 — is_active 소프트 토글만 (format_presets 관행).
 * - sizeToleranceMm 기본 1 = 워커 LEGACY_SIZE_TOLERANCE_MM(변경 절대 금지,
 *   2026-06-10 회귀 이력)과 정합하는 "노출용" 값. v1 은 읽기 전용 —
 *   검증측(워커) 상수·로직 무접촉.
 */
@Entity('book_specs')
@Index('idx_book_specs_site_active', ['siteId', 'isActive'])
export class BookSpec {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 외부 식별자 'bs_...' — 내부 UUID 를 외부에 그대로 노출하지 않는다 */
  @Column({ length: 40, unique: true })
  uid: string;

  /** 사이트 스코프 (null = 전역 공개 판형) */
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  /** 표시명 — 예: 'A4 무선 소프트커버' */
  @Column({ length: 100 })
  name: string;

  /** 커버 종류 — softcover|hardcover|... (COVER_TYPE_SEED_CODES 계열 자유 코드) */
  @Column({ name: 'cover_type', length: 30 })
  coverType: string;

  /** 제본 방식 — binding_types.code canonical 어휘 승계 (perfect|saddle|...) */
  @Column({ name: 'binding_type', length: 30 })
  bindingType: string;

  @Column({ type: 'enum', enum: ['portrait', 'landscape'], default: 'portrait' })
  orientation: 'portrait' | 'landscape';

  /** 내지 재단 폭 mm */
  @Column({ name: 'inner_trim_width_mm', type: 'float' })
  innerTrimWidthMm: number;

  /** 내지 재단 높이 mm */
  @Column({ name: 'inner_trim_height_mm', type: 'float' })
  innerTrimHeightMm: number;

  /** 사방(per-edge) 블리드 mm. 작업사이즈 = 재단 + bleedMm*2 */
  @Column({ name: 'bleed_mm', type: 'float', default: 3 })
  bleedMm: number;

  /**
   * 사이즈 검증 허용오차 mm (노출용).
   * 기본 1 = 워커 검증 폴백 LEGACY_SIZE_TOLERANCE_MM
   * (apps/worker/src/config/validation.config.ts — 변경 절대 금지 값)과 정합.
   * templateSetId 연결 시 template_sets.size_tolerance_mm 계약값을 우선 노출
   * (검증측과 동일한 우선순위 규칙 — 설계서 §1.2).
   */
  @Column({ name: 'size_tolerance_mm', type: 'float', default: 1 })
  sizeToleranceMm: number;

  @Column({ name: 'page_min', type: 'int' })
  pageMin: number;

  @Column({ name: 'page_max', type: 'int' })
  pageMax: number;

  @Column({ name: 'page_increment', type: 'int', default: 2 })
  pageIncrement: number;

  /** SpineService 파라미터 참조 — null 이면 defaultPaperCode/bindingType 폴백 */
  @Column({ name: 'spine_formula', type: 'json', nullable: true })
  spineFormula: BookSpecSpineFormula | null;

  @Column({ name: 'default_paper_code', type: 'varchar', length: 30, nullable: true })
  defaultPaperCode: string | null;

  /** 기본 templateSet 연결(선택) — sizeToleranceMm 우선 노출 근거 */
  @Column({ name: 'template_set_id', type: 'varchar', length: 36, nullable: true })
  templateSetId: string | null;

  /** 과금 확정(설계서 §9-1) 전 null 운용 */
  @Column({ type: 'json', nullable: true })
  pricing: Record<string, unknown> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
