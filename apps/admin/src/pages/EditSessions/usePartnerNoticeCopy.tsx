import { useState } from 'react';
import { Modal, Typography, message } from 'antd';
import { editDataApi, type StaffSessionItem } from '../../api/edit-data';
import { buildPartnerNoticeText, describeApiError } from './editDataHelpers';

const { Paragraph } = Typography;

/**
 * 파트너 사후 통지용 '통지 정보 복사' (2026-09-30, 3-B 운영 원칙) — 편집 세션 목록·삭제 리스트 공용.
 * 통지 정보는 목록 행이 아니라 복사 직전에 다시 읽은 값으로 만든다(편집기 탭에서 편집완료하면 파일 id 가 바뀐다).
 */
export function usePartnerNoticeCopy(): {
  copyingId: string | null;
  copyNotice: (record: StaffSessionItem) => Promise<void>;
} {
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const copyNotice = async (record: StaffSessionItem): Promise<void> => {
    setCopyingId(record.id);
    let latest: StaffSessionItem = record;
    try {
      const fresh = await editDataApi.listSessions({
        siteId: record.siteId ?? undefined,
        orderSeqno: record.orderSeqno ?? undefined,
        deleted: 'include',
        limit: 100,
      });
      const found = fresh.items.find((s) => s.id === record.id);
      if (found) {
        latest = found;
      } else {
        message.warning('최신 세션 정보를 찾지 못해 목록 값으로 만듭니다. 새로고침 후 다시 확인하세요.');
      }
    } catch (err: unknown) {
      message.warning(
        `${describeApiError(err, '최신 세션 정보를 불러오지 못했습니다.')} 목록 값으로 만듭니다.`,
      );
    }
    const text = buildPartnerNoticeText(latest, new Date());
    try {
      await navigator.clipboard.writeText(text);
      message.success('파트너 통지 정보를 복사했습니다.');
    } catch {
      // 재조회 await 뒤라 사용자 제스처가 끊겨 거부될 수 있다(Safari 등) — 클릭 한 번으로 복사하는 창으로 대체
      Modal.info({
        title: '파트너 통지 정보',
        width: 640,
        content: (
          <Paragraph copyable={{ text }} style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {text}
          </Paragraph>
        ),
        okText: '닫기',
      });
    } finally {
      setCopyingId((cur) => (cur === record.id ? null : cur));
    }
  };

  return { copyingId, copyNotice };
}
