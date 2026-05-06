import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Site (Tenant) — 외부 사이트(쇼핑몰/앱/서비스) 메타데이터.
 *
 * 플랫폼화 Phase A의 핵심 엔티티. admin > 기본설정 페이지에서 관리.
 *
 * - editor_auth_code: PHP/외부 사이트가 X-API-Key로 사용 (호환성: 기존 .env API_KEYS 값 시드)
 * - worker_auth_code: 워커 호출용 (편집기와 분리, 향후 권한 차등 가능)
 * - status: active(운영중) / suspended(운영중지)
 * - 한 site row가 한 외부 사이트(예: 북모아, 점보포토)에 매핑
 */
@Entity('sites')
export class Site {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 사이트명 (admin 표시용, 예: "북모아 메인") */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 사이트 메인 URL (예: https://www.bookmoa.co.kr) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  domain: string | null;

  /** 사용자 보관함 (편집 완료 후 PDF 보관) URL — 편집기 returnUrl base */
  @Column({ name: 'return_url_base', type: 'varchar', length: 500, nullable: true })
  returnUrlBase: string | null;

  /** 외부 사이트 자체 PDF 저장 webhook (워커 결과 push용, 선택) */
  @Column({ name: 'upload_callback_url', type: 'varchar', length: 500, nullable: true })
  uploadCallbackUrl: string | null;

  /**
   * 편집기 인증코드 (X-API-Key).
   * Migration 시 기존 .env API_KEYS 값을 첫 row에 그대로 시드 → PHP 측 변경 0 보장.
   */
  @Index('idx_sites_editor_auth_code', { unique: true })
  @Column({ name: 'editor_auth_code', type: 'varchar', length: 200 })
  editorAuthCode: string;

  /** 워커 인증코드 (별도 키. Phase A에선 editor_auth_code와 동일 값으로 시드 가능) */
  @Index('idx_sites_worker_auth_code', { unique: true })
  @Column({ name: 'worker_auth_code', type: 'varchar', length: 200 })
  workerAuthCode: string;

  /** 운영 상태: 'active' | 'suspended' */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'suspended';

  // ─────────────────────────────────────────────────────
  // Phase B — 사이트별 워커 옵션 (default 정책)
  // 워커 잡 생성 시 호출자가 명시 안 하면 site default 머지.
  // ─────────────────────────────────────────────────────

  /** PDF 자동 변환(addPages/applyBleed) 사용 여부 default */
  @Column({ name: 'pdf_conversion_enabled', type: 'boolean', default: true })
  pdfConversionEnabled: boolean;

  /** Before/After 미리보기 URL — Admin Worker UI에서 비교용 */
  @Column({ name: 'before_after_url', type: 'varchar', length: 500, nullable: true })
  beforeAfterUrl: string | null;

  /** 단위 구분 default: 'mm' | 'inch' */
  @Column({ name: 'default_unit', type: 'varchar', length: 10, default: 'mm' })
  defaultUnit: 'mm' | 'inch';

  /** 작업서(workorder) 체크 사용 여부 default */
  @Column({ name: 'check_workorder', type: 'boolean', default: true })
  checkWorkorder: boolean;

  /** 재단선(cutting line) 체크 사용 여부 default */
  @Column({ name: 'check_cutting', type: 'boolean', default: true })
  checkCutting: boolean;

  /** 안전선(safe zone) 체크 사용 여부 default */
  @Column({ name: 'check_safezone', type: 'boolean', default: true })
  checkSafezone: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
