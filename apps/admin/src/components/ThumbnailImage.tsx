import { useCallback, useState } from 'react';
import { Tooltip } from 'antd';
import { FileImageOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { resolveStorageUrl } from '../lib/axios';

/**
 * Admin 의 모든 썸네일 표시 페이지가 공유하는 단일 컴포넌트.
 *
 * - url 이 NULL/undefined  → "미리보기 미설정" placeholder + Tooltip
 * - url 이 있지만 로딩 실패 → "이미지 로드 실패" placeholder + Tooltip (URL 표시)
 * - 정상                  → <img>
 *
 * 운영 nginx 가 /storage/* 직접 서빙. resolveStorageUrl 이 dev/prod 경로를
 * 자동 처리하므로 사용처는 url 만 넘기면 됨.
 *
 * 2026-05-15: 더미 데이터 청소 + 친절한 placeholder UX (옵션 C)
 */
interface ThumbnailImageProps {
  url: string | null | undefined;
  /** placeholder 와 image 의 정사각형 크기(px). 기본 60. */
  size?: number;
  /** alt 텍스트 (스크린리더용) */
  alt?: string;
  /** placeholder hover 시 보여줄 안내 (예: 템플릿명) — 미설정 사유를 친절히 알림 */
  emptyHint?: string;
}

export const ThumbnailImage: React.FC<ThumbnailImageProps> = ({
  url,
  size = 60,
  alt = 'thumbnail',
  emptyHint,
}) => {
  const [hasError, setHasError] = useState(false);
  const fullUrl = resolveStorageUrl(url ?? undefined) || null;

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  // 1) URL 자체가 없음 — "미리보기 미설정" 친절 placeholder
  if (!fullUrl) {
    return (
      <Tooltip
        title={
          emptyHint
            ? `${emptyHint} — 미리보기 미설정 (편집 후 저장 시 자동 생성)`
            : '미리보기 미설정 — 편집 후 저장 시 자동 생성됩니다'
        }
      >
        <div
          aria-label="미리보기 미설정"
          style={{
            width: size,
            height: size,
            borderRadius: 4,
            backgroundColor: '#fafafa',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            border: '1px dashed #d9d9d9',
            color: '#bfbfbf',
            cursor: 'help',
          }}
        >
          <EyeInvisibleOutlined style={{ fontSize: Math.max(16, size * 0.32) }} />
          {size >= 56 && (
            <span style={{ fontSize: 9, lineHeight: 1, color: '#bfbfbf' }}>미설정</span>
          )}
        </div>
      </Tooltip>
    );
  }

  // 2) URL 있으나 로딩 실패 — "이미지 로드 실패" placeholder
  if (hasError) {
    return (
      <Tooltip title={`이미지 로드 실패: ${fullUrl}`}>
        <div
          aria-label="이미지 로드 실패"
          style={{
            width: size,
            height: size,
            borderRadius: 4,
            backgroundColor: '#fff1f0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            border: '1px solid #ffccc7',
            color: '#ff7875',
            cursor: 'help',
          }}
        >
          <FileImageOutlined style={{ fontSize: Math.max(16, size * 0.32) }} />
          {size >= 56 && (
            <span style={{ fontSize: 9, lineHeight: 1, color: '#ff7875' }}>로드 실패</span>
          )}
        </div>
      </Tooltip>
    );
  }

  // 3) 정상 표시
  return (
    <img
      src={fullUrl}
      alt={alt}
      onError={handleError}
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        borderRadius: 4,
        backgroundColor: '#f5f5f5',
        border: '1px solid #f0f0f0',
      }}
    />
  );
};

export default ThumbnailImage;
