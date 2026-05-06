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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
