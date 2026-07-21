/**
 * PDF 검증 관련 설정 상수
 * @see docs/PDF_VALIDATION_WBS.md - WBS 1.1
 */
export const VALIDATION_CONFIG = {
  // Ghostscript 설정
  /** GS 실행 타임아웃 (ms) */
  GS_TIMEOUT: 5000,
  /** inkcov 분석 최대 페이지 수 */
  GS_MAX_PAGES: 50,
  /** GS 동시 실행 제한 (워커당) */
  GS_CONCURRENCY: 2,

  // 파일 크기 제한
  /** 최대 파일 크기 — env WORKER_MAX_FILE_SIZE(바이트) 로 상향 가능. 기본 100MB. */
  MAX_FILE_SIZE: Number(process.env.WORKER_MAX_FILE_SIZE) || 100 * 1024 * 1024,
  /** 대형 파일 임계값 - GS 분석 선택적 (50MB) */
  LARGE_FILE_THRESHOLD: 50 * 1024 * 1024,

  // 트랙 B-(d): 경량 검증(스트리밍) 경로 토글
  /**
   * true 면 검증을 ON 경로(스트림 다운로드 + qpdf 메타 + 청크 스트리밍 검출)로 수행 →
   * 2GB 도 상수 메모리. false(기본)면 기존 OFF 경로(전체버퍼 + pdf-lib.load) 유지.
   * 파리티(구↔신 결과 동일) 검증 통과 후 env WORKER_LIGHTWEIGHT_VALIDATION=true 로 활성.
   */
  LIGHTWEIGHT_VALIDATION:
    String(process.env.WORKER_LIGHTWEIGHT_VALIDATION || '').toLowerCase() === 'true',
  /**
   * 트랙 B-(f): true 면 변환(conversion)·합성(synthesis)·렌더를 상수메모리 경로로 수행
   * (스트림 다운로드 + qpdf 메타/병합 — 끝단 2GB). false(기본)면 기존 pdf-lib/arraybuffer 경로.
   * 골든파일 파리티(출력 PDF 동일성) 통과 후 env WORKER_LIGHTWEIGHT_SYNTHESIS=true 로 ON.
   * ⚠️ 불변식: 로컬 /storage 입력일 때 ON(downloadToTempFile→resolveLocalPath, WORKER_STORAGE_PATH)
   *   과 OFF(downloadFile, STORAGE_PATH+접두사제거)가 같은 파일로 수렴하려면
   *   STORAGE_PATH === WORKER_STORAGE_PATH + '/storage' 여야 한다(prod: /app/storage = /app + /storage).
   *   프로덕션은 R2(api://) 입력이라 무관하지만, local 드라이버 cutover 시 이 정렬을 확인할 것.
   */
  LIGHTWEIGHT_SYNTHESIS:
    String(process.env.WORKER_LIGHTWEIGHT_SYNTHESIS || '').toLowerCase() === 'true',

  // C+ 게이팅: autoFixable 정직화 킬스위치
  /**
   * true 면 autoFixable 을 실행기가 배선된 fixMethod(WIRED_FIX_METHODS)에만 부여한다.
   * **기본 OFF** — 기본 상태에서 프로덕션 행동 변화 0 (레거시 autoFixable 그대로).
   * ⚠️ ON 전환 선결 게이트(소비처가 FIXABLE→FAILED flip 에 안전해야 함):
   *   ① [해소 2026-07-11] editor ContentPdfAttachModal — A4 하드코드 → templateSet 판형
   *      주입(trimSize prop) + 폴링 result 이중중첩 파싱 수정
   *   ② [해소 2026-07-11] API 세션 검증 경로 — G2a size 폴백(templateSet 판형) +
   *      G2b 세션 한정 FIXABLE 동등 처리(isFixableEquivalentFailure, VALIDATE 잡 게이트)
   *      → 세션 상태 전이·웹훅 이벤트는 게이팅 ON/OFF 무관 보존
   *   ③ [잔여] bookmoa 사전 고지 회신 (.cursor/plans/NOTICE_bookmoa_autofixable_gating_2026-07-11.md)
   */
  WIRED_FIXABLE_GATING:
    String(process.env.WORKER_WIRED_FIXABLE_GATING || '').toLowerCase() === 'true',

  // C-2a: crop mark(재단 기하) 검증 킬스위치
  /**
   * true 면 TrimBox 기반 재단 기하 검증(validateCropMarks)을 수행한다. **기본 OFF** —
   * 기본 상태에서 프로덕션 행동 변화 0. 켜도 orderOptions.cropMarkEnabled === true 인
   * 잡에서만 동작(이중 게이트: TemplateSet/파트너 opt-in + env 카나리).
   * 전부 warning(비차단) — isValid/COMPLETED·FIXABLE·FAILED 상태 판정에 영향 없음.
   */
  CROP_MARK_VALIDATION:
    String(process.env.WORKER_CROP_MARK_VALIDATION || '').toLowerCase() === 'true',

  // R-44: 표지 spine(전개폭) 검증 허용오차 — 관찰 1단계는 현행 2mm 유지.
  /**
   * 무선/양장 각각 env 로 조정(orderOptions.spineToleranceMm 이 최우선).
   * 2단계 강화(무선 ±1.0 / 양장 ±1.5 제안)는 관찰기간 mismatch 로그 리뷰 후
   * env 로만 내린다(코드 무변경 롤아웃) — bookmoa 회신 §C-3 확정 대기.
   */
  SPINE_TOLERANCE_MM_PERFECT: Number(process.env.SPINE_TOLERANCE_MM_PERFECT || '') || 2,
  SPINE_TOLERANCE_MM_HARDCOVER: Number(process.env.SPINE_TOLERANCE_MM_HARDCOVER || '') || 2,
  /** F13: orderOptions.spineToleranceMm 파트너 오버라이드 상한 — 무상한 값으로 표지
   *  치수 검증을 무력화하는 페이로드 차단(워커측 클램프, 초과 시 warn 계측). */
  SPINE_TOLERANCE_MM_MAX: Number(process.env.SPINE_TOLERANCE_MM_MAX || '') || 5,

  // 스프레드(펼침면) 감지
  /** 스프레드 판정 점수 임계값 */
  SPREAD_SCORE_THRESHOLD: 70,
  /** 사이즈 허용 오차 (mm) */
  SIZE_TOLERANCE_MM: 2,

  // 사철 제본
  /** 사철 제본 최대 페이지 수 */
  SADDLE_STITCH_MAX_PAGES: 64,

  // 포인트 → mm 변환 계수
  /** 1 포인트 = 0.352778mm */
  PT_TO_MM: 0.352778,

  // 해상도 감지
  /** 인쇄 품질 권장 해상도 (DPI) */
  RECOMMENDED_DPI: 300,
  /** 최소 허용 해상도 (DPI) - 이 값 미만이면 경고 */
  MIN_ACCEPTABLE_DPI: 150,
} as const;

export type ValidationConfig = typeof VALIDATION_CONFIG;

/**
 * 신규 상품별 설정값의 전역 기본값 (C-2b: 소비처 배선 완료 — 값-동일 리팩터).
 * @see 데이터모델 계약 — bleed_mm / crop_mark_enabled / size_tolerance_mm
 */
/**
 * 고객 업로드 PDF 사이즈 검증 허용오차 기본값(mm) — templateSet 계약(P4 변환) 기본값.
 * 소비처: pdf-converter.service.ts resolveMode/applyImpositionMode 의 폴백.
 * ⚠️ validatePageSize(검증)의 폴백은 이 값이 아니라 LEGACY_SIZE_TOLERANCE_MM(1mm)다 —
 *    이원 체제는 의도된 설계이며 통일 금지(아래 LEGACY_SIZE_TOLERANCE_MM 주석 참조).
 */
export const DEFAULT_SIZE_TOLERANCE_MM = 0.2;
/**
 * 레거시/전역 검증 허용오차 폴백(mm) — sizeToleranceMm 미탑재 검증 잡에 적용.
 * 소비처: pdf-validator.service.ts validatePageSize 의 `?? LEGACY_SIZE_TOLERANCE_MM`.
 * ⚠️ 절대 0.2 로 좁히지 말 것 — 2026-06-10 실회귀(전 상품 1mm→0.2mm 엄격화로
 *    0.2~1mm 오차 파일이 SIZE_MISMATCH FAIL 로 반전) 재발이다.
 *    @see apps/api/src/worker-jobs/worker-jobs.service.ts (전역 기본값 미주입 결정)
 */
export const LEGACY_SIZE_TOLERANCE_MM = 1;
/**
 * 사방(per-edge) 블리드 기본값(mm). 작업사이즈 = 재단 + bleedMm*2.
 * 소비처: pdf-validator.service.ts (`orderOptions.bleed ?? DEFAULT_BLEED_MM`).
 */
export const DEFAULT_BLEED_MM = 3;
/**
 * 재단선 마커 표기 기본값(OFF) — 문서화용 상수.
 * ⚠️ 실제 ON/OFF 판정은 worker 가 아니라 API 가 수행한다:
 *    TemplateSet.cropMarkEnabled(DB default false)===true 인 세션에서만
 *    edit-sessions.service 가 orderOptions.cropMarkEnabled 를 잡에 주입하며,
 *    worker 는 전달받은 값을 소비할 뿐 이 기본값으로 판정하지 않는다.
 */
export const DEFAULT_CROP_MARK_ENABLED = false;

/**
 * C+ 게이팅(2026-07-11): 실행기가 실제 배선된 fixMethod 만 등록하는 단일 소스.
 *
 * WIRED_FIXABLE_GATING(위 킬스위치) ON 일 때 pdf-validator 의 autoFixable 은
 * `WIRED_FIX_METHODS.has(fixMethod)` 로만 부여된다 — 실행 수단이 없는 항목이
 * FIXABLE(원클릭 해결 가능처럼 보이는 잡 상태)로 노출되는 것을 차단(정직한 계약).
 * validation.processor 의 FIXABLE 파생(`errors.every(autoFixable)`)은 무수정 —
 * 이 게이팅만으로 자동으로 정직해진다.
 *
 *  - 'addBlankPages': POST /worker-jobs/fix-pagecount(/external) → CONVERT 잡
 *    padToMultiple → pdf-converter addPages (2026-06-25 LIVE. 최초 배선 실행기).
 *  - 'extendBleed': POST /worker-jobs/fix-bleed → CONVERT 잡 convertOptions.editSize
 *    (templateSet 판형+bleedMm×2 서버 권위 산출) → pdf-converter resolveMode/
 *    applyImpositionMode('center' 무스케일 중앙 배치) (2026-07-13 배선. 워커 무수정 —
 *    기존 임포지션 부품 소비만).
 *  - 'resizeWithPadding' / 'adjustSpine': 실행기 미구현.
 *    구현·배선 후 이 집합에 추가하면 해당 에러/경고의 autoFixable 이 자동
 *    복원된다(파트너 모달은 autoFixable 게이트라 소비처 무수정).
 *
 * ⚠️ fixMethod 필드 자체는 '의도 메타데이터'로 계속 발행한다(제거 금지) —
 *    실행기 출시 시 계약 변경 없이 재활성하기 위함.
 * @see .cursor/plans/NOTICE_bookmoa_autofixable_gating_2026-07-11.md (파트너 고지·선결 게이트)
 */
export const WIRED_FIX_METHODS: ReadonlySet<string> = new Set([
  'addBlankPages',
  'extendBleed',
]);
