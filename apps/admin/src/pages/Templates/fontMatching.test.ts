// fontMatching 순수 함수 단위테스트 — vitest (node 환경, DOM 불필요)
import { describe, it, expect } from 'vitest';
import {
  normalizeFontKey,
  buildFontMatchRows,
  seedFontFormatFor,
  ttfFileNameFor,
} from './fontMatching';
import type { LibraryFontLike } from './fontMatching';

const lib = (id: string, name: string, isActive = true): LibraryFontLike => ({
  id,
  name,
  isActive,
});

describe('normalizeFontKey', () => {
  it('trim + 소문자 — 편집기 fontManager.findFontByName 과 동일', () => {
    expect(normalizeFontKey('  Myriad Pro  ')).toBe('myriad pro');
    expect(normalizeFontKey('MYRIAD PRO')).toBe('myriad pro');
  });

  it('NFC/NFD 유니코드 변형이 같은 키로 수렴 — FontPlugin 변형 매칭과 동치', () => {
    const nfc = '태나다체'.normalize('NFC');
    const nfd = '태나다체'.normalize('NFD');
    expect(nfc).not.toBe(nfd); // 전제: 실제로 다른 표기
    expect(normalizeFontKey(nfc)).toBe(normalizeFontKey(nfd));
  });

  it('IDML 원본 끝공백 패딩(실측: "태나다체   ")을 흡수한다', () => {
    expect(normalizeFontKey('태나다체   ')).toBe(normalizeFontKey('태나다체'));
  });
});

describe('buildFontMatchRows', () => {
  it('활성 라이브러리 폰트와 매칭되면 available + 폰트 id/표기 보존', () => {
    const rows = buildFontMatchRows(
      ['Myriad Pro'],
      [lib('f1', 'myriad pro')] // 대소문자 다른 등록 표기도 매칭
    );
    expect(rows).toEqual([
      {
        fontName: 'Myriad Pro',
        status: 'available',
        libraryFontId: 'f1',
        libraryFontName: 'myriad pro',
      },
    ]);
  });

  it('라이브러리에 없으면 missing', () => {
    const rows = buildFontMatchRows(['THE명품고딕M'], [lib('f1', 'Myriad Pro')]);
    expect(rows).toEqual([{ fontName: 'THE명품고딕M', status: 'missing' }]);
  });

  it('비활성 폰트만 있으면 inactive (편집기는 isActive=true 만 로드)', () => {
    const rows = buildFontMatchRows(['페이퍼로지'], [lib('f1', '페이퍼로지', false)]);
    expect(rows[0].status).toBe('inactive');
    expect(rows[0].libraryFontId).toBe('f1');
  });

  it('같은 이름이 활성+비활성으로 중복 등록되어 있으면 활성을 우선한다', () => {
    const rows = buildFontMatchRows(
      ['Minion Pro'],
      [lib('f-off', 'Minion Pro', false), lib('f-on', 'minion pro', true)]
    );
    expect(rows[0]).toMatchObject({ status: 'available', libraryFontId: 'f-on' });
    // 순서 반대여도 동일
    const rows2 = buildFontMatchRows(
      ['Minion Pro'],
      [lib('f-on', 'minion pro', true), lib('f-off', 'Minion Pro', false)]
    );
    expect(rows2[0]).toMatchObject({ status: 'available', libraryFontId: 'f-on' });
  });

  it('doc.fonts 의 중복(대소문자/NFD 변형 포함)은 1행으로 합치고 첫 표기를 유지', () => {
    const rows = buildFontMatchRows(
      ['태나다체', '태나다체'.normalize('NFD'), 'Adobe 명조 Std', 'ADOBE 명조 STD'],
      []
    );
    expect(rows.map((r) => r.fontName)).toEqual(['태나다체', 'Adobe 명조 Std']);
    expect(rows.every((r) => r.status === 'missing')).toBe(true);
  });

  it('빈/공백 폰트명은 무시, 라이브러리가 비어 있으면 전부 missing', () => {
    const rows = buildFontMatchRows(['', '   ', 'Myriad Pro'], []);
    expect(rows).toEqual([{ fontName: 'Myriad Pro', status: 'missing' }]);
  });

  it('NFD 등록 라이브러리 폰트도 NFC doc 폰트와 매칭된다', () => {
    const rows = buildFontMatchRows(
      ['페이퍼로지'],
      [lib('f1', '페이퍼로지'.normalize('NFD'))]
    );
    expect(rows[0].status).toBe('available');
  });
});

describe('seedFontFormatFor / ttfFileNameFor', () => {
  it('ttf/otf/woff2 만 시딩 형식으로 분류, 그 외 null', () => {
    expect(seedFontFormatFor('font.ttf')).toBe('ttf');
    expect(seedFontFormatFor('Font.OTF')).toBe('otf');
    expect(seedFontFormatFor('a.WOFF2')).toBe('woff2');
    expect(seedFontFormatFor('a.woff')).toBeNull(); // woff(1) 미지원 — woff2ToTtf 는 wOF2 전용
    expect(seedFontFormatFor('확장자없음')).toBeNull();
    expect(seedFontFormatFor('a.zip')).toBeNull();
  });

  it('woff2 파일명 → 변환 TTF 파일명 (마지막 확장자 교체, 경로 접두 제거, .ttf 멱등)', () => {
    expect(ttfFileNameFor('NotoSansKR.woff2')).toBe('NotoSansKR.ttf');
    expect(ttfFileNameFor('fonts/태나다체.WOFF2')).toBe('태나다체.ttf');
    expect(ttfFileNameFor('My.Font.woff2')).toBe('My.Font.ttf');
    expect(ttfFileNameFor('이미.ttf')).toBe('이미.ttf');
  });
});
