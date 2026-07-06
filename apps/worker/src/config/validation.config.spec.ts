/**
 * C-2b: DEFAULT_* 상수 값 스냅샷 단언.
 *
 * 이 상수들은 pdf-validator / pdf-converter 의 실효 폴백값으로 배선돼 있다.
 * 값이 바뀌면 라이브 파트너(검증 통과/실패 판정)가 즉시 영향을 받으므로,
 * "의도된 변경"이 아니면 이 spec 이 깨져야 한다.
 *
 * ⚠️ 특히 LEGACY_SIZE_TOLERANCE_MM(=1) 은 절대 0.2 로 좁히지 말 것 —
 *    2026-06-10 실회귀(sizeToleranceMm 미탑재 잡 전부가 1mm→0.2mm 로 엄격화되어
 *    기존 통과 파일이 SIZE_MISMATCH FAIL 로 반전) 의 재발이다.
 */
import {
  DEFAULT_SIZE_TOLERANCE_MM,
  LEGACY_SIZE_TOLERANCE_MM,
  DEFAULT_BLEED_MM,
  DEFAULT_CROP_MARK_ENABLED,
} from './validation.config';

describe('validation.config DEFAULT_* 상수 값 고정 (C-2b)', () => {
  it('DEFAULT_BLEED_MM 은 3 (구 pdf-validator 로컬 DEFAULT_BLEED 와 동일)', () => {
    expect(DEFAULT_BLEED_MM).toBe(3);
  });

  it('DEFAULT_SIZE_TOLERANCE_MM 은 0.2 (컨버터 resolveMode/applyImpositionMode 폴백)', () => {
    expect(DEFAULT_SIZE_TOLERANCE_MM).toBe(0.2);
  });

  it('LEGACY_SIZE_TOLERANCE_MM 은 1 — validatePageSize 폴백. 0.2 로 좁히면 2026-06-10 회귀 재발', () => {
    expect(LEGACY_SIZE_TOLERANCE_MM).toBe(1);
    // 이원 체제(1mm 레거시 검증 폴백 vs 0.2mm templateSet 계약 기본)는 의도된 설계 —
    // 두 값이 "통일"되면 안 된다.
    expect(LEGACY_SIZE_TOLERANCE_MM).not.toBe(DEFAULT_SIZE_TOLERANCE_MM);
  });

  it('DEFAULT_CROP_MARK_ENABLED 는 false (문서화용 — 판정은 API templateSet 이 수행)', () => {
    expect(DEFAULT_CROP_MARK_ENABLED).toBe(false);
  });
});
