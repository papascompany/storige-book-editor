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
import { v4 as uuidv4 } from 'uuid';
import type { EditPage } from '@storige/types';
import { EditSession } from './edit-session.entity';

/**
 * 편집 세션의 자동저장 시점 스냅샷 (BB-Phase 3 백엔드 인프라).
 *
 * 사용 시나리오
 * - editor.service.autoSave가 debounce(1분) 윈도우마다 신규 version 1개 push
 * - 세션당 최근 N개(LRU 20)만 유지 — 초과는 가장 오래된 것부터 삭제
 * - 사용자가 HistoryPanel에서 시점 list 확인 + "여기로 복원" 액션 트리거
 *
 * 정책
 * - pages: 시점에 저장된 EditPage[] 전체 (canvas_data 포함) JSON
 * - thumbnail_url: 향후 썸네일 생성 시 사용 (1차 nullable)
 * - createdBy: 자동저장한 사용자 (보안/권한 검사용)
 */
@Entity('edit_session_versions')
@Index('idx_edit_session_version_session', ['session'])
@Index('idx_edit_session_version_saved_at', ['savedAt'])
export class EditSessionVersion {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @ManyToOne(() => EditSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: EditSession;

  @RelationId((v: EditSessionVersion) => v.session)
  sessionId: string;

  /**
   * 시점 시각 (자동 저장 트리거 시점)
   */
  @CreateDateColumn({ name: 'saved_at' })
  savedAt: Date;

  /**
   * 시점에 보관된 페이지 데이터 (canvas_data 포함)
   */
  @Column({ type: 'json' })
  pages: EditPage[];

  /**
   * 시점 페이지 수 (UI list 표시용)
   */
  @Column({ name: 'page_count', type: 'int', default: 0 })
  pageCount: number;

  /**
   * 시점을 만든 사용자 ID
   */
  @Column({ name: 'created_by', type: 'varchar', length: 36, nullable: true })
  createdBy: string | null;

  /**
   * 썸네일 이미지 URL (향후 도입, 1차는 null)
   */
  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
