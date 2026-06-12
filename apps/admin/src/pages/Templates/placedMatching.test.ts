// placedMatching 순수 함수 단위테스트 — vitest (node 환경, DOM 불필요)
import { describe, it, expect } from 'vitest';
import {
  classifyUploadName,
  companionMimeFor,
  fixDataUrlMime,
  collectPlacedLinkNames,
  buildPlacedMatchRows,
  humanizePlacedFailReason,
} from './placedMatching';

describe('classifyUploadName', () => {
  it('idml/psd/zip/이미지/기타를 분류한다', () => {
    expect(classifyUploadName('LA-383_26_KYM.idml')).toBe('idml');
    expect(classifyUploadName('cover.PSD')).toBe('psd');
    expect(classifyUploadName('package.Zip')).toBe('zip');
    expect(classifyUploadName('17146230.jpg')).toBe('image');
    expect(classifyUploadName('photo.JPEG')).toBe('image');
    expect(classifyUploadName('a.png')).toBe('image');
    expect(classifyUploadName('a.webp')).toBe('image');
    expect(classifyUploadName('확장자없음')).toBe('other');
    expect(classifyUploadName('script.jsx')).toBe('other');
  });

  it('브라우저 디코드 불가 이미지(TIF/EPS/PDF/AI 등)는 unsupported-image — 변환기 skipped 와 동일 집합(psd 제외)', () => {
    expect(classifyUploadName('scan.tif')).toBe('unsupported-image');
    expect(classifyUploadName('scan.TIFF')).toBe('unsupported-image');
    expect(classifyUploadName('vector.eps')).toBe('unsupported-image');
    expect(classifyUploadName('design.ai')).toBe('unsupported-image');
    expect(classifyUploadName('doc.pdf')).toBe('unsupported-image');
    expect(classifyUploadName('old.wmf')).toBe('unsupported-image');
    expect(classifyUploadName('old.pict')).toBe('unsupported-image');
    // psd 는 본체 변환 형식 — unsupported 가 아니다
    expect(classifyUploadName('cover.psd')).toBe('psd');
  });
});

describe('companionMimeFor / fixDataUrlMime', () => {
  it('확장자 → MIME 매핑(변환기 PACKAGE_IMAGE_MIME 과 동일 집합)', () => {
    expect(companionMimeFor('a.jpg')).toBe('image/jpeg');
    expect(companionMimeFor('a.PNG')).toBe('image/png');
    expect(companionMimeFor('a.tif')).toBeNull();
  });

  it('비식별 dataURL 헤더를 확장자 MIME 으로 교정한다', () => {
    expect(fixDataUrlMime('a.jpg', 'data:application/octet-stream;base64,AAAA')).toBe(
      'data:image/jpeg;base64,AAAA'
    );
    expect(fixDataUrlMime('a.png', 'data:;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('이미 올바른 image/* 헤더는 그대로 둔다(멱등)', () => {
    const ok = 'data:image/jpeg;base64,AAAA';
    expect(fixDataUrlMime('a.jpg', ok)).toBe(ok);
    // 지원 외 확장자는 손대지 않음
    const raw = 'data:application/octet-stream;base64,AAAA';
    expect(fixDataUrlMime('a.tif', raw)).toBe(raw);
  });
});

describe('collectPlacedLinkNames', () => {
  it('placed.linkFileName 만 프레임당 1개씩 수집한다(중복 허용)', () => {
    const items = [
      { self: 'u8c6', placed: { linkFileName: '17146230.jpg' } },
      { self: 'u9d3', placed: { linkFileName: '17146230.jpg' } }, // 실측: 동일 링크 2프레임
      { self: 'u111' }, // placed 아님
      { self: 'u222', placed: { linkFileName: null } }, // 링크명 없음 → 제외
      null,
    ];
    expect(collectPlacedLinkNames(items)).toEqual(['17146230.jpg', '17146230.jpg']);
  });
});

describe('buildPlacedMatchRows', () => {
  it('실패 목록에 없는 링크는 matched, 다중 프레임은 frames 로 집계한다', () => {
    const rows = buildPlacedMatchRows({
      linkNames: ['17146230.jpg', '17146230.jpg'],
      failed: [],
      providedNames: ['17146230.jpg'],
    });
    expect(rows).toEqual([
      { fileName: '17146230.jpg', frames: 2, status: 'matched' },
    ]);
  });

  it('not-provided 실패는 ✗ + 미업로드 안내', () => {
    const rows = buildPlacedMatchRows({
      linkNames: ['cover.jpg'],
      failed: [{ fileName: 'cover.jpg', reason: 'not-provided' }],
      providedNames: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].reason).toContain('업로드되지 않았습니다');
  });

  it('zip 에서 skipped 된 형식은 not-provided 사유를 형식 안내로 구체화한다', () => {
    const rows = buildPlacedMatchRows({
      linkNames: ['scan.tif'],
      failed: [{ fileName: 'scan.tif', reason: 'not-provided' }],
      providedNames: [],
      skipped: ['scan.tif'],
    });
    expect(rows[0].status).toBe('failed');
    expect(rows[0].reason).toContain('디코드할 수 없는 형식');
  });

  it('대소문자/NFC 차이를 무시하고 매칭한다(변환기 lookup 과 동일 의미론)', () => {
    const rows = buildPlacedMatchRows({
      linkNames: ['17146230.JPG'],
      failed: [],
      providedNames: ['17146230.jpg'],
    });
    expect(rows).toEqual([{ fileName: '17146230.JPG', frames: 1, status: 'matched' }]);

    // NFD(한글 자모 분해) 업로드 파일명 ↔ NFC 링크명
    const nfd = '표지이미지.jpg'.normalize('NFD');
    const rows2 = buildPlacedMatchRows({
      linkNames: ['표지이미지.jpg'],
      failed: [],
      providedNames: [nfd],
    });
    expect(rows2).toEqual([{ fileName: '표지이미지.jpg', frames: 1, status: 'matched' }]);
  });

  it('어떤 링크와도 안 맞는 업로드 이미지는 unused 행으로 안내한다(중복 1회)', () => {
    const rows = buildPlacedMatchRows({
      linkNames: ['a.jpg'],
      failed: [],
      providedNames: ['a.jpg', 'typo.jpg', 'TYPO.JPG'],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ fileName: 'a.jpg', status: 'matched' });
    expect(rows[1]).toMatchObject({ fileName: 'typo.jpg', frames: 0, status: 'unused' });
  });

  it('복원 미지원 사유(rotated-inner-transform 등)는 사람이 읽을 메시지로 변환한다', () => {
    const rows = buildPlacedMatchRows({
      linkNames: ['r.jpg'],
      failed: [{ fileName: 'r.jpg', reason: 'rotated-inner-transform' }],
      providedNames: ['r.jpg'],
    });
    expect(rows[0].status).toBe('failed');
    expect(rows[0].reason).toContain('회전');
  });

  it('fileName 없는 failed 항목은 무시한다(표시할 이름 없음)', () => {
    const rows = buildPlacedMatchRows({
      linkNames: [],
      failed: [{ fileName: null, reason: 'not-provided' }],
      providedNames: [],
    });
    expect(rows).toEqual([]);
  });
});

describe('humanizePlacedFailReason', () => {
  it('bake-failed 프리픽스/기타 사유 폴백', () => {
    expect(humanizePlacedFailReason('bake-failed: decode error', false)).toContain('디코드/크롭');
    expect(humanizePlacedFailReason('degenerate-transform', false)).toContain(
      'degenerate-transform'
    );
  });
});
