// 변환 폰트(doc.fonts) ↔ 폰트 라이브러리(API /library/fonts) 매칭 — 순수 함수, 단위테스트 대상.
//
// 매칭 의미론은 편집기 resolve 와 동일:
// - apps/editor/src/utils/fontManager.ts findFontByName — trim + toLowerCase(대소문자 무시)
// - packages/canvas-core FontPlugin findFontVariantMatch — trim + NFC/NFD 유니코드 변형 비교
// 두 경로를 모두 흡수하도록 키를 NFC 정규화 + trim + 소문자로 통일한다.
// (NFC 키 비교는 NFD 표기 입력도 같은 키로 수렴 — FontPlugin 의 변형 매칭과 동치)
//
// 주의: FontPlugin 의 변형 매칭 자체는 대소문자를 구분하지만, 라이브러리 등록 시
// doc 폰트명을 그대로 name 으로 쓰는 한(이 화면의 시딩 플로우) 표기가 일치하므로
// 대소문자 무시 매칭이 더 넓은 안전망이다 — 기존 등록 폰트의 표기 편차(예: 'Myriad pro')도
// '사용 가능'으로 인정한다(편집기 UI 매칭 findFontByName 과 동일).

/** 폰트명 비교 키: NFC 정규화 + trim + 소문자 */
export const normalizeFontKey = (name: string): string =>
  name.normalize('NFC').trim().toLowerCase();

/** /library/fonts 응답에서 매칭에 필요한 최소 형태 */
export interface LibraryFontLike {
  id: string;
  name: string;
  isActive: boolean;
}

export type FontMatchStatus = 'available' | 'inactive' | 'missing';

export interface FontMatchRow {
  /** 표시용 폰트명(doc.fonts 의 첫 등장 표기, NFC) */
  fontName: string;
  /**
   * available — 활성 라이브러리 폰트와 매칭(편집기에서 사용 가능)
   * inactive  — 라이브러리에 있으나 비활성(편집기는 isActive=true 만 로드 — 활성화 필요)
   * missing   — 라이브러리에 없음(시딩 필요)
   */
  status: FontMatchStatus;
  /** 매칭된 라이브러리 폰트 id (available/inactive 만) */
  libraryFontId?: string;
  /** 매칭된 라이브러리 폰트의 등록 표기 — doc 표기와 다를 수 있어 진단용으로 보존 */
  libraryFontName?: string;
}

/**
 * 변환 폰트 목록별 라이브러리 매칭 ✓/✗ 행 생성.
 *
 * - docFonts: 변환기 doc.fonts (IDML Resources/Fonts.xml FontFamily, trim 정합 8a23f93).
 *   같은 키의 중복은 1행으로 합치고 첫 등장 표기를 유지한다.
 * - libraryFonts: GET /library/fonts 전체(활성+비활성). 같은 키가 여럿이면 활성 폰트 우선
 *   (편집기는 isActive=true 만 로드하므로 활성 매칭이 실사용과 일치).
 */
export const buildFontMatchRows = (
  docFonts: string[],
  libraryFonts: LibraryFontLike[]
): FontMatchRow[] => {
  // 라이브러리 인덱스: 키 → 폰트(활성 우선)
  const libByKey = new Map<string, LibraryFontLike>();
  for (const f of libraryFonts) {
    if (!f?.name) continue;
    const k = normalizeFontKey(f.name);
    const existing = libByKey.get(k);
    if (!existing || (!existing.isActive && f.isActive)) {
      libByKey.set(k, f);
    }
  }

  const rows: FontMatchRow[] = [];
  const seen = new Set<string>();
  for (const name of docFonts) {
    if (!name || !name.trim()) continue;
    const k = normalizeFontKey(name);
    if (seen.has(k)) continue;
    seen.add(k);

    const display = name.normalize('NFC').trim();
    const lib = libByKey.get(k);
    if (!lib) {
      rows.push({ fontName: display, status: 'missing' });
    } else {
      rows.push({
        fontName: display,
        status: lib.isActive ? 'available' : 'inactive',
        libraryFontId: lib.id,
        libraryFontName: lib.name,
      });
    }
  }
  return rows;
};

/** 시딩 업로드 허용 형식 — ttf/otf 는 그대로 등록, woff2 는 woff2ToTtf 변환 경유 */
export type SeedFontFormat = 'ttf' | 'otf' | 'woff2';

/**
 * 업로드 파일명 → 시딩 형식 분류 (지원 외 형식이면 null).
 * woff(1) 는 제외 — 편집기 woff2ToTtf 파이프라인이 woff2 전용(wOF2 매직 검증)이고,
 * opentype.js 직접 파싱 대상도 ttf/otf 뿐이다.
 */
export const seedFontFormatFor = (fileName: string): SeedFontFormat | null => {
  const base = fileName.split('/').pop() || fileName;
  const idx = base.lastIndexOf('.');
  const ext = idx >= 0 ? base.slice(idx + 1).toLowerCase() : '';
  if (ext === 'ttf' || ext === 'otf' || ext === 'woff2') return ext;
  return null;
};

/** woff2 파일명 → 변환 TTF 업로드용 파일명 (마지막 확장자 교체, 디렉토리 접두 제거, .ttf 멱등) */
export const ttfFileNameFor = (fileName: string): string => {
  const base = fileName.split('/').pop() || fileName;
  const idx = base.lastIndexOf('.');
  const stem = idx > 0 ? base.slice(0, idx) : base;
  return `${stem}.ttf`;
};
