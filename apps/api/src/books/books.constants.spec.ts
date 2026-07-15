/**
 * creationType × asset_type 호환 매트릭스 계약 spec (설계서 §6.1).
 *
 * ERR_ASSET_INCOMPATIBLE 판정의 근거 표를 전 셀(4×5=20) 단언으로 고정한다 —
 * 매트릭스가 "실수로" 바뀌면 red. W3/W4 가 바인딩 자산(cover_binding/
 * contents_binding)을 구현할 때 이 표를 정본으로 참조한다.
 */
import {
  BOOK_ASSET_TYPES,
  BOOK_CREATION_TYPES,
  isAssetCompatible,
  type BookAssetType,
  type BookCreationType,
} from './books.constants';

// 설계서 §6.1 표 전사 (✅=true, ✖=false)
const EXPECTED: Record<BookCreationType, Record<BookAssetType, boolean>> = {
  PDF_UPLOAD: {
    pdf_cover: true,
    pdf_contents: true,
    photo: false,
    cover_binding: false,
    contents_binding: false,
  },
  TEMPLATE: {
    pdf_cover: false,
    pdf_contents: false,
    photo: true,
    cover_binding: true,
    contents_binding: true,
  },
  MIX_COVER_TEMPLATE: {
    pdf_cover: false,
    pdf_contents: true,
    photo: true,
    cover_binding: true,
    contents_binding: false,
  },
  EDITOR_SESSION: {
    pdf_cover: false,
    pdf_contents: false,
    photo: false,
    cover_binding: false,
    contents_binding: false,
  },
};

describe('BOOK_ASSET_COMPATIBILITY — creationType×asset_type 매트릭스 (설계서 §6.1)', () => {
  for (const creationType of BOOK_CREATION_TYPES) {
    describe(creationType, () => {
      for (const assetType of BOOK_ASSET_TYPES) {
        const want = EXPECTED[creationType][assetType];
        it(`${assetType} => ${want ? '호환(✅)' : '불가(✖)'}`, () => {
          expect(isAssetCompatible(creationType, assetType)).toBe(want);
        });
      }
    });
  }

  it('EDITOR_SESSION 은 수동 자산 투입이 전부 무효(세션 산출 자동 연결)', () => {
    for (const assetType of BOOK_ASSET_TYPES) {
      expect(isAssetCompatible('EDITOR_SESSION', assetType)).toBe(false);
    }
  });
});
