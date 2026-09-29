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

  /**
   * 파일 보존 기간(일) (2026-06-15). null/0 = 영구보관(기본).
   * 이 사이트가 업로드(/files/upload/external)한 파일에 expires_at = now + N일 자동 설정 →
   * retention cron 이 만료분 삭제. 인쇄 완료분 정리용(테넌트가 원본에서 재생성 가능).
   * bookmoa 등 영구보관이 필요한 사이트는 null 유지.
   */
  @Column({ name: 'retention_days', type: 'int', nullable: true })
  retentionDays: number | null;

  /**
   * 편집데이터 보관기간(일) (2026-09-29, migrations/20260930). NULL = 미설정(기한 제한 없음 · 보존 보장 없음).
   *
   * retentionDays(위, 업로드 파일 자동삭제 기간)와 **별개**다. 이 값은 세션 created_at 부터 N일 동안
   * Storige 관리자가 이 사이트의 편집데이터(편집 세션·버전·세션이 직접 참조하는 표지/내지/첨부 PDF 파일·
   * 합성 결과)를 언제든 편집·수정·삭제·합성·재합성할 수 있도록 보장한다. 기간 안의 세션이 참조하는 파일은
   * 업로드 파일 자동삭제·48h 영구삭제에서 제외된다. 기간이 지나도 자동삭제하지 않는다.
   * 계산: src/staff-edit-data/edit-retention.ts computeEditRetention.
   * (TS optional — 기존 코드·테스트가 만드는 Site 리터럴 호환. DB 로드 값은 항상 number | null.)
   */
  @Column({ name: 'edit_retention_days', type: 'int', nullable: true })
  editRetentionDays?: number | null;

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

  // ─────────────────────────────────────────────────────
  // Phase 1-1 (2026-05-16) — 외부 도메인 보안 정책
  // CORS / iframe / postMessage / webhook 검증의 단일 출처.
  // 자세한 사양: docs/PHASE_0_CONTRACT_DECISIONS_2026-05-16.md §2 D-10
  // ─────────────────────────────────────────────────────

  /**
   * CORS allowlist (외부 사이트 브라우저 origin).
   * 예: ['https://www.bookmoa.co.kr', 'https://bookmoa-mobile.vercel.app']
   * 빈 배열이면 환경변수(CORS_ORIGIN) + 정적 패턴 fallback.
   */
  @Column({ name: 'allowed_origins', type: 'json', nullable: true })
  allowedOrigins: string[] | null;

  /**
   * iframe embed parent origin allowlist (CSP frame-ancestors 합성용).
   * 예: ['https://www.bookmoa.co.kr', 'https://bookmoa-mobile.vercel.app']
   * 빈 배열이면 'self' 만 허용.
   */
  @Column({ name: 'frame_ancestors', type: 'json', nullable: true })
  frameAncestors: string[] | null;

  /**
   * 편집기 실행 모드. Phase 0 결정(D-1): inline embed 단일.
   * enum 은 향후 확장 여지를 위한 컬럼 유지. 현재 값은 'inline' 만 사용.
   */
  @Column({ name: 'editor_launch_mode', type: 'varchar', length: 20, default: 'inline' })
  editorLaunchMode: 'inline';

  /** Editor IIFE 번들 URL (외부 사이트가 자체 CDN 에서 로드할 때 공급 정보) */
  @Column({ name: 'editor_bundle_url', type: 'varchar', length: 500, nullable: true })
  editorBundleUrl: string | null;

  /** Editor CSS URL */
  @Column({ name: 'editor_css_url', type: 'varchar', length: 500, nullable: true })
  editorCssUrl: string | null;

  /** Editor 버전 (외부 사이트가 캐싱/검증에 사용) */
  @Column({ name: 'editor_version', type: 'varchar', length: 50, nullable: true })
  editorVersion: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
