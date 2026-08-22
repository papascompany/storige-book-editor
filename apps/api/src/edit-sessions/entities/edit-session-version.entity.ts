import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  Index,
  RelationId,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { EditSessionEntity } from './edit-session.entity';

/**
 * 스냅샷 사유.
 * - autosave: 통상 canvasData 덮어쓰기 직전 보존(세션당 debounce)
 * - shrink:   페이지 수(캔버스 배열 길이)가 **줄어드는** 덮어쓰기 직전 보존 — 절단 의심.
 *             debounce 무시·트림 보호(최근 SHRINK_KEEP 건 보존).
 * - restore:  버전 복원 직전의 현재 상태 보존(복원 되돌리기용)
 */
export type EditSessionVersionReason = 'autosave' | 'shrink' | 'restore';

/**
 * `file_edit_sessions`(프로덕션 /embed 경로) 의 canvasData 덮어쓰기 직전 스냅샷 (P1-4, 2026-08-22).
 *
 * 배경: 동화책 R2(시드 반감→자동저장이 서버 영구 덮어씀)에서 드러난 구조 원인 —
 * 레거시 `edit_sessions` 에만 버전 테이블(`edit_session_versions`)이 있고, 실제 프로덕션
 * 세션 모델(`file_edit_sessions`)은 `update()` 가 canvasData 를 그대로 덮어써 복구 불가였다.
 *
 * 정책(경량):
 * - `EditSessionsService.update()` 에서 canvasData 가 실제로 바뀔 때 **이전 값**을 저장한다
 *   (= 덮어쓰기 직전 상태 보존). 동일 내용이면 저장하지 않는다.
 * - 세션당 debounce(VERSION_DEBOUNCE_MS) — 단 page_count 감소(shrink)는 debounce 를 무시한다.
 * - 세션당 최근 VERSION_KEEP 건 유지, shrink 는 별도로 SHRINK_KEEP 건 보호.
 * - 세션 삭제(hard) 시 CASCADE. softDelete 는 세션 행이 남으므로 스냅샷도 남는다.
 */
@Entity('file_edit_session_versions')
@Index('idx_fesv_session_created', ['session', 'createdAt'])
export class EditSessionVersionEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @ManyToOne(() => EditSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: EditSessionEntity;

  @RelationId((v: EditSessionVersionEntity) => v.session)
  sessionId: string;

  /** 덮어쓰기 직전의 canvasData 원본(단일=객체, 스프레드=캔버스 JSON 배열) */
  @Column({ name: 'canvas_data', type: 'json' })
  canvasData: any;

  /** 스냅샷 시점의 캔버스 수(배열 길이, 단일이면 1) — UI 목록/절단 판정용 */
  @Column({ name: 'page_count', type: 'int', default: 0 })
  pageCount: number;

  /** 덮어쓴 새 데이터의 캔버스 수(shrink 진단용) */
  @Column({ name: 'next_page_count', type: 'int', nullable: true })
  nextPageCount: number | null;

  @Column({ type: 'varchar', length: 16, default: 'autosave' })
  reason: EditSessionVersionReason;

  /** 스냅샷 시점의 세션 status(복원 시 참고) */
  @Column({ name: 'session_status', type: 'varchar', length: 20, nullable: true })
  sessionStatus: string | null;

  /** 스냅샷을 유발한 호출자(회원 memberSeqno, 게스트=0) */
  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = randomUUID();
  }
}
