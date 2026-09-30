// editDataHelpers 순수 함수 단위테스트 — vitest (node 환경, DOM 불필요)
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { ApiErrorCode, RetentionInfo, StaffSessionItem } from '../../api/edit-data';
import {
  ERROR_MESSAGES,
  LIST_UNAVAILABLE_MESSAGE,
  buildEditorUrl,
  canCompleteItem,
  canDeleteItem,
  canOpenEditor,
  canRestoreItem,
  canSynthesize,
  describeApiError,
  errorMessage,
  formatYmd,
  buildPartnerNoticeText,
  isEditAllowed,
  isOrderLinked,
  orderLinkedAfterActionMessage,
  orderLinkedConfirmCopy,
  orderMetaSummary,
  parseApiError,
  retentionLabel,
  retentionTagColor,
  toUtcIsoSeconds,
  withEditRetentionDays,
} from './editDataHelpers';

const DAY = 86_400_000;
// 로컬 시간대 기준 정오 — 어떤 TZ 에서도 YYYY-MM-DD 가 흔들리지 않게
const NOW = new Date(2026, 8, 29, 12, 0, 0);

function retention(state: RetentionInfo['state'], until: Date | null, days: number | null = 30): RetentionInfo {
  return { days, until: until ? until.toISOString() : null, state, anchor: 'createdAt' };
}

function item(overrides: Partial<StaffSessionItem> = {}): StaffSessionItem {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    siteId: 'site-1',
    siteName: '북모아',
    orderSeqno: 100,
    memberSeqno: 7,
    memberId: 'user7',
    orderMeta: null,
    isGuest: false,
    status: 'editing',
    mode: 'both',
    templateSetId: null,
    templateSetName: null,
    coverFileId: null,
    contentFileId: null,
    contentPdfFileId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: null,
    deletedAt: null,
    retention: retention('active', new Date(NOW.getTime() + 10 * DAY)),
    staffEditedAfterComplete: false,
    canDelete: true,
    ...overrides,
  };
}

describe('retentionLabel', () => {
  it('미설정', () => {
    expect(retentionLabel(retention('unset', null, null), NOW)).toBe('미설정');
  });

  it('보관중 · D-n (YYYY-MM-DD)', () => {
    const until = new Date(2026, 9, 9, 12, 0, 0); // 10일 뒤
    expect(retentionLabel(retention('active', until), NOW)).toBe('보관중 · D-10 (2026-10-09)');
  });

  it('만료 (YYYY-MM-DD)', () => {
    const until = new Date(2026, 8, 1, 12, 0, 0);
    expect(retentionLabel(retention('expired', until), NOW)).toBe('만료 (2026-09-01)');
  });

  it('D-day 경계 — 정확히 24h 남음=D-1, 24h+1ms=D-2, 1ms 남음=D-1, 0 이하=D-0', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    expect(retentionLabel(retention('active', at(DAY)), NOW)).toMatch(/^보관중 · D-1 \(/);
    expect(retentionLabel(retention('active', at(DAY + 1)), NOW)).toMatch(/^보관중 · D-2 \(/);
    expect(retentionLabel(retention('active', at(1)), NOW)).toMatch(/^보관중 · D-1 \(/);
    // 서버가 active 로 보냈지만 클라이언트 시계로는 이미 지남 → 음수 대신 D-0
    expect(retentionLabel(retention('active', at(-5)), NOW)).toMatch(/^보관중 · D-0 \(/);
  });

  it('formatYmd 는 0 채움', () => {
    expect(formatYmd(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});

describe('retentionTagColor', () => {
  it('unset/active/expired → default/green/red', () => {
    expect(retentionTagColor(retention('unset', null, null))).toBe('default');
    expect(retentionTagColor(retention('active', NOW))).toBe('green');
    expect(retentionTagColor(retention('expired', NOW))).toBe('red');
  });
});

describe('작업 가능 판정', () => {
  const expired = retention('expired', new Date(NOW.getTime() - DAY));

  it('isEditAllowed — 만료만 막는다(미설정·보관중 허용)', () => {
    expect(isEditAllowed(item())).toBe(true);
    expect(isEditAllowed(item({ retention: retention('unset', null, null) }))).toBe(true);
    expect(isEditAllowed(item({ retention: expired }))).toBe(false);
  });

  it('canOpenEditor — 정상 세션 true', () => {
    expect(canOpenEditor(item())).toBe(true);
  });

  it('canOpenEditor — NULL 사이트·삭제·만료면 false', () => {
    expect(canOpenEditor(item({ siteId: null }))).toBe(false);
    expect(canOpenEditor(item({ deletedAt: NOW.toISOString() }))).toBe(false);
    expect(canOpenEditor(item({ retention: expired }))).toBe(false);
  });

  it('canSynthesize — 편집기 열기와 같은 조건', () => {
    expect(canSynthesize(item())).toBe(true);
    expect(canSynthesize(item({ siteId: null }))).toBe(false);
    expect(canSynthesize(item({ retention: expired }))).toBe(false);
  });

  it('canCompleteItem — 미완료만, 완료·삭제·만료면 false', () => {
    expect(canCompleteItem(item({ status: 'draft' }))).toBe(true);
    expect(canCompleteItem(item({ status: 'editing' }))).toBe(true);
    expect(canCompleteItem(item({ status: 'complete' }))).toBe(false);
    expect(canCompleteItem(item({ deletedAt: NOW.toISOString() }))).toBe(false);
    expect(canCompleteItem(item({ retention: expired }))).toBe(false);
  });

  it('canDeleteItem — 만료여도 canDelete 면 true', () => {
    expect(canDeleteItem(item({ retention: expired, canDelete: true }))).toBe(true);
  });

  it('canDeleteItem — canDelete=false(사이트 매니저) 또는 이미 삭제면 false', () => {
    expect(canDeleteItem(item({ canDelete: false }))).toBe(false);
    expect(canDeleteItem(item({ deletedAt: NOW.toISOString() }))).toBe(false);
  });

  it('canRestoreItem — 삭제된 세션 + canDelete + 보관기간 안', () => {
    const deletedAt = NOW.toISOString();
    expect(canRestoreItem(item({ deletedAt }))).toBe(true);
    expect(canRestoreItem(item({ deletedAt, canDelete: false }))).toBe(false);
    expect(canRestoreItem(item({ deletedAt, retention: expired }))).toBe(false);
    expect(canRestoreItem(item({ deletedAt: null }))).toBe(false);
  });
});

describe('buildEditorUrl', () => {
  const base = 'https://editor.example.com';
  const path = '/embed?sessionId=abc-123&adminEdit=session';
  const access = 'eyJ.acc+ess/tok=en';
  const refresh = 'r&f=1#x';

  it('토큰은 # 뒤에만, URL 인코딩되어 실린다', () => {
    const url = buildEditorUrl(base, path, access, refresh);
    expect(url).toBe(
      `${base}${path}#token=${encodeURIComponent(access)}&refreshToken=${encodeURIComponent(refresh)}`,
    );
    const [, fragment] = url.split('#');
    const fp = new URLSearchParams(fragment);
    expect(fp.get('token')).toBe(access);
    expect(fp.get('refreshToken')).toBe(refresh);
  });

  it('쿼리에는 sessionId·adminEdit=session 만 있고 token 은 없다', () => {
    const parsed = new URL(buildEditorUrl(base, path, access, refresh));
    expect(parsed.searchParams.get('sessionId')).toBe('abc-123');
    expect(parsed.searchParams.get('adminEdit')).toBe('session');
    expect(parsed.search).not.toContain('token');
    expect(parsed.searchParams.has('token')).toBe(false);
    expect(parsed.searchParams.has('refreshToken')).toBe(false);
  });

  it('base 끝 슬래시와 path 의 기존 fragment 를 정리한다', () => {
    const url = buildEditorUrl(`${base}/`, `${path}#stale`, 'a', 'b');
    expect(url).toBe(`${base}${path}#token=a&refreshToken=b`);
  });

  it('관리자 로그인 토큰(authStore)은 절대 포함되지 않는다', () => {
    const adminJwt = 'ADMIN-JWT-SHOULD-NEVER-LEAK';
    const url = buildEditorUrl(base, path, 'minted-access', 'minted-refresh');
    expect(url).not.toContain(adminJwt);
    // 헬퍼 모듈은 스토어·브라우저 저장소에 접근하지 않는다
    const src = readFileSync(new URL('./editDataHelpers.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/authStore|localStorage|sessionStorage/);
  });
});

describe('errorMessage', () => {
  const contractMessages: Record<string, string> = {
    EDIT_RETENTION_EXPIRED: '보관기간이 지나 작업할 수 없습니다',
    STAFF_SESSION_SITE_REQUIRED: '사이트가 없는 이전 세션은 편집기·합성을 지원하지 않습니다',
    STAFF_DELETE_NOT_ALLOWED: '삭제 권한이 없습니다',
    STAFF_AUDIT_UNAVAILABLE: '감사 기록을 저장할 수 없어 중단했습니다',
    STAFF_BASELINE_UNAVAILABLE: '편집 전 스냅샷을 저장할 수 없어 중단했습니다',
    SESSION_ALREADY_COMPLETE: '이미 완료된 세션입니다',
    OUTPUT_STALE:
      '관리자 편집 후 편집완료가 되지 않았습니다. 편집기에서 편집완료로 PDF를 다시 만든 뒤 합성하세요',
    SESSION_DELETED: '삭제된 세션입니다. 먼저 복구하세요',
    SESSION_ASSEMBLY_INCOMPLETE: '합성에 필요한 파일이 없습니다',
  };

  it.each(Object.entries(contractMessages))('%s → 지정 문구', (code, msg) => {
    expect(errorMessage(code)).toBe(msg);
  });

  it('계약 오류 코드 전부 문구가 있다', () => {
    const allCodes: ApiErrorCode[] = [
      'STAFF_ROLE_REQUIRED',
      'STAFF_DELETE_NOT_ALLOWED',
      'SESSION_NOT_FOUND',
      'GRANT_NOT_FOUND',
      'JOB_NOT_FOUND',
      'EDIT_RETENTION_EXPIRED',
      'STAFF_SESSION_SITE_REQUIRED',
      'SESSION_DELETED',
      'SESSION_ALREADY_COMPLETE',
      'OUTPUT_STALE',
      'SESSION_ASSEMBLY_INCOMPLETE',
      'STAFF_AUDIT_UNAVAILABLE',
      'STAFF_BASELINE_UNAVAILABLE',
      'PARTNER_OPERATOR_UNAVAILABLE',
      'JOB_NOT_COMPLETED',
      'OUTPUT_NOT_FOUND',
      'FILE_NOT_ON_DISK',
      'TENANT_FORBIDDEN',
      'FILE_NOT_FOUND',
      'STREAM_ERROR',
    ];
    for (const code of allCodes) {
      expect(errorMessage(code), code).toBeTruthy();
    }
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...allCodes].sort());
  });

  it('모르는 코드·빈 값은 null', () => {
    expect(errorMessage('SOMETHING_ELSE')).toBeNull();
    expect(errorMessage(undefined)).toBeNull();
    expect(errorMessage('toString')).toBeNull();
  });
});

describe('parseApiError / describeApiError', () => {
  const axiosErr = (status: number, data: unknown) => ({ response: { status, data } });

  it('Nest 본문 {code,message} 에서 코드 추출 → 매핑 문구', () => {
    const err = axiosErr(409, { code: 'EDIT_RETENTION_EXPIRED', message: 'x', retentionUntil: 'y' });
    expect(parseApiError(err)).toEqual({ status: 409, code: 'EDIT_RETENTION_EXPIRED', message: 'x' });
    expect(describeApiError(err, 'fallback')).toBe('보관기간이 지나 작업할 수 없습니다');
  });

  it('중첩 {message:{code}} 도 인식', () => {
    const err = axiosErr(409, { statusCode: 409, message: { code: 'OUTPUT_STALE', message: 'm' } });
    expect(parseApiError(err).code).toBe('OUTPUT_STALE');
  });

  it('목록 404 → 서버 업데이트 중 안내, 목록이 아니면 서버 메시지/대체 문구', () => {
    const err = axiosErr(404, { message: 'Cannot GET /api/admin/edit-data/sessions' });
    expect(describeApiError(err, 'fallback', { listContext: true })).toBe(LIST_UNAVAILABLE_MESSAGE);
    expect(describeApiError(err, 'fallback')).toBe('Cannot GET /api/admin/edit-data/sessions');
    expect(describeApiError(new Error('network'), 'fallback')).toBe('fallback');
  });

  it('목록 404 라도 SESSION_NOT_FOUND 같은 계약 코드면 코드 문구 우선', () => {
    const err = axiosErr(404, { code: 'SESSION_NOT_FOUND' });
    expect(describeApiError(err, 'fb', { listContext: true })).toBe('세션을 찾을 수 없습니다');
  });
});

describe('orderMetaSummary', () => {
  it('null → -', () => {
    expect(orderMetaSummary(null)).toBe('-');
  });
  it('문자열/객체 size 모두 처리', () => {
    expect(orderMetaSummary({ productName: '무선책자', size: 'A5', quantity: 10 })).toBe('무선책자 · A5 · 10부');
    expect(orderMetaSummary({ title: '앨범', size: { width: 148, height: 210 } })).toBe('앨범 · 148×210mm');
  });
});

describe('withEditRetentionDays (사이트 폼 payload)', () => {
  it('건드리지 않았으면 키 자체를 생략', () => {
    const out = withEditRetentionDays({ name: 'a', editRetentionDays: 30 }, false);
    expect(out).toEqual({ name: 'a' });
    expect('editRetentionDays' in out).toBe(false);
  });

  it('건드리고 비웠으면 null 전송', () => {
    expect(withEditRetentionDays({ name: 'a', editRetentionDays: undefined }, true)).toEqual({
      name: 'a',
      editRetentionDays: null,
    });
    expect(withEditRetentionDays({ name: 'a', editRetentionDays: null }, true)).toEqual({
      name: 'a',
      editRetentionDays: null,
    });
  });

  it('건드리고 값이 있으면 그대로 전송', () => {
    expect(withEditRetentionDays({ name: 'a', editRetentionDays: 365 }, true)).toEqual({
      name: 'a',
      editRetentionDays: 365,
    });
  });
});

describe('파트너 주문 연결 세션 안전장치 (3-B, 2026-09-30)', () => {
  it('isOrderLinked — 양의 주문번호만 연결로 본다', () => {
    expect(isOrderLinked({ orderSeqno: 100 })).toBe(true);
    expect(isOrderLinked({ orderSeqno: null })).toBe(false);
    expect(isOrderLinked({ orderSeqno: 0 })).toBe(false);
    expect(isOrderLinked({ orderSeqno: -1 })).toBe(false);
    expect(isOrderLinked({ orderSeqno: Number.NaN })).toBe(false);
  });

  it('확인 창 문구 — 사이트·주문번호·통지 절차를 담고, 삭제만 위험 버튼', () => {
    const rec = item({ siteName: '프린티', orderSeqno: 555 });
    for (const action of ['open', 'complete', 'delete', 'synthesize'] as const) {
      const copy = orderLinkedConfirmCopy(action, rec);
      expect(copy.title).toContain('파트너 주문');
      expect(copy.notice).toContain('프린티 주문번호 555');
      expect(copy.notice).toContain('세션 id를 넣어');
      expect(copy.notice).toContain('통지 정보 복사');
      expect(copy.ackLabel).toBe('프린티에 사전 통지했습니다');
      expect(copy.effect.length).toBeGreaterThan(0);
      expect(copy.danger).toBe(action === 'delete');
    }
  });

  it('확인 창 효과 문구 — 서버 실제 동작과 맞춘다', () => {
    const rec = item();
    // 저장만으로는 파일 id 가 바뀌지 않고 편집완료 때 바뀐다
    expect(orderLinkedConfirmCopy('open', rec).effect).toContain('편집완료를 눌러야 새 PDF와 새 파일 id');
    // 관리자 완료 처리는 표지·내지 PDF 를 만들지 않는다 → 편집기 편집완료로 유도
    expect(orderLinkedConfirmCopy('complete', rec).effect).toContain('여기서 완료하지 말고');
    // 삭제: sessionId 재편집은 404, 주문번호 진입은 새 세션 가능, 통지는 삭제 리스트
    const del = orderLinkedConfirmCopy('delete', rec).effect;
    expect(del).toContain('404');
    expect(del).toContain('빈 새 세션');
    expect(del).toContain('[삭제 리스트]');
    // 합성: 세션 파일 id 불변, 알림은 기본 꺼짐
    expect(orderLinkedConfirmCopy('synthesize', rec).effect).toContain('기본 꺼짐');
  });

  it('사이트 없는 레거시 세션 — siteId 로, 둘 다 없으면 통지 대상 확인 안내', () => {
    expect(orderLinkedConfirmCopy('open', item({ siteName: null, siteId: 's-9' })).ackLabel).toBe(
      's-9에 사전 통지했습니다',
    );
    const legacy = orderLinkedConfirmCopy('delete', item({ siteName: null, siteId: null, orderSeqno: 77 }));
    expect(legacy.ackLabel).toBe('해당 파트너에 사전 통지했습니다');
    expect(legacy.notice).toContain('사이트 없는 이전 세션');
    expect(legacy.notice).toContain('주문번호 77');
  });

  it('사후 안내 — 삭제는 [삭제 리스트], 편집기 열기는 편집완료 뒤 복사', () => {
    const rec = { siteName: '북모아', siteId: 'site-1' };
    expect(orderLinkedAfterActionMessage('delete', rec)).toContain('[삭제 리스트]의 [통지 정보 복사]');
    expect(orderLinkedAfterActionMessage('open', rec)).toContain('편집완료한 뒤');
    expect(orderLinkedAfterActionMessage('complete', rec)).toContain('북모아에');
    expect(orderLinkedAfterActionMessage('complete', { siteName: null, siteId: null })).toContain(
      '해당 파트너에',
    );
  });

  it('toUtcIsoSeconds — 밀리초 제거, 잘못된 값은 null', () => {
    expect(toUtcIsoSeconds('2026-09-30T01:02:03.456Z')).toBe('2026-09-30T01:02:03Z');
    expect(toUtcIsoSeconds(new Date(Date.UTC(2026, 8, 30, 9, 0, 0)))).toBe('2026-09-30T09:00:00Z');
    expect(toUtcIsoSeconds('not-a-date')).toBeNull();
    expect(toUtcIsoSeconds(null)).toBeNull();
  });

  it('통지 텍스트 — 세션 id·파일 id·UTC 시각을 모두 싣는다', () => {
    const text = buildPartnerNoticeText(
      item({
        siteId: 'site-1',
        siteName: '북모아',
        orderSeqno: 100,
        status: 'complete',
        completedAt: '2026-09-30T01:02:03.000Z',
        updatedAt: '2026-09-30T01:05:00.000Z',
        coverFileId: 'cover-abc',
        contentFileId: 'content-def',
        contentPdfFileId: null,
        deletedAt: null,
        staffEditedAfterComplete: false,
      }),
      new Date(Date.UTC(2026, 8, 30, 2, 0, 0)),
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('[Storige 관리자 작업 통지]');
    expect(text).toContain('사이트: 북모아 (site-1)');
    expect(text).toContain('세션 주문번호(orderSeqno): 100');
    expect(text).toContain('세션 ID: 11111111-2222-3333-4444-555555555555');
    expect(text).toContain('상태: 편집완료');
    expect(text).toContain('편집완료 시각(UTC): 2026-09-30T01:02:03Z');
    expect(text).toContain('최종 수정 시각(UTC): 2026-09-30T01:05:00Z');
    expect(text).toContain('표지 파일 ID: cover-abc');
    expect(text).toContain('내지 파일 ID: content-def');
    expect(text).toContain('첨부 내지 파일 ID: -');
    expect(text).toContain('작성 시각(UTC): 2026-09-30T02:00:00Z');
    expect(text).not.toContain('주의:');
  });

  it('통지 텍스트 — 편집 후 미완료면 주의 문구, 삭제됨이면 삭제 시각', () => {
    const stale = buildPartnerNoticeText(item({ staffEditedAfterComplete: true }), NOW);
    expect(stale).toContain('편집 전 PDF');
    const deleted = buildPartnerNoticeText(
      item({ deletedAt: '2026-09-30T03:00:00.999Z' }),
      NOW,
    );
    expect(deleted).toContain('상태: 삭제됨 (2026-09-30T03:00:00Z)');
  });
});
