// 편집데이터 관리 컴포넌트 테스트용 세션 픽스처 (2026-10-03). 중립 이름만 쓴다.
import type { StaffSessionItem } from '../api/edit-data';

export function makeSessionItem(overrides: Partial<StaffSessionItem> = {}): StaffSessionItem {
  return {
    id: 'sess-0001',
    siteId: 'site-1',
    siteName: '테스트사이트',
    orderSeqno: 1001,
    memberSeqno: null,
    memberId: 'member-1',
    orderMeta: null,
    isGuest: false,
    status: 'editing',
    mode: 'both',
    templateSetId: null,
    templateSetName: null,
    coverFileId: 'file-cover-old',
    contentFileId: 'file-content-old',
    contentPdfFileId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    retention: { days: null, until: null, state: 'unset', anchor: 'createdAt' },
    staffEditedAfterComplete: false,
    canDelete: true,
    ...overrides,
  };
}
