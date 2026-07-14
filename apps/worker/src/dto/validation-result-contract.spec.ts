/**
 * S-1 ValidationResult 타입 정본화 contract test (Stage 0, 2026-07-15)
 *
 * 정본 = 이 워커의 ValidationResultDto({isValid, errors, warnings, metadata}).
 * @storige/types 의 WorkerValidationResult 는 그 정본의 필드 1:1 미러다.
 *
 * 이 spec 은 두 가지를 고정한다:
 *  1) 컴파일 타임 — 워커 DTO ↔ 정본 타입의 키 집합 일치 + 워커 DTO 값이
 *     정본 타입에 할당 가능(워커 enum 코드값 ⊂ string). 어느 쪽이든 필드가
 *     어긋나면 이 파일이 컴파일되지 않아 테스트가 red 가 된다.
 *  2) 런타임 — 워커가 발신하는 대표 shape 이 {isValid, errors, warnings, metadata}
 *     4키 그대로임을 JSON 직렬화로 단언(런타임 응답 shape 불변 증명).
 *
 * ⚠️ 이 테스트가 빨간불이면: 워커 DTO 를 바꿨거나 @storige/types 미러를 바꾼 것.
 *    additive-only — 기존 필드 변경·삭제는 파트너/에디터 소비 계약 위반이다.
 */
import type {
  WorkerValidationResult,
  WorkerValidationError,
  WorkerValidationWarning,
  WorkerPdfMetadata,
} from '@storige/types';
import {
  ValidationResultDto,
  ValidationError,
  ValidationWarning,
  PdfMetadata,
  ErrorCode,
  WarningCode,
} from './validation-result.dto';

// ────────────────────────────────────────────────────────────────────────────
// 1) 컴파일 타임 구조 일치 단언
// ────────────────────────────────────────────────────────────────────────────

/** 두 타입의 키 집합이 완전히 같으면 true, 아니면 false 로 평가되는 타입 */
type KeysEqual<A, B> = [Exclude<keyof A, keyof B>] extends [never]
  ? [Exclude<keyof B, keyof A>] extends [never]
    ? true
    : false
  : false;

// 키 집합 일치 — 필드 추가/삭제/개명 시 즉시 컴파일 에러
const _resultKeysMatch: KeysEqual<ValidationResultDto, WorkerValidationResult> = true;
const _errorKeysMatch: KeysEqual<ValidationError, WorkerValidationError> = true;
const _warningKeysMatch: KeysEqual<ValidationWarning, WorkerValidationWarning> = true;
const _metadataKeysMatch: KeysEqual<PdfMetadata, WorkerPdfMetadata> = true;

// 할당 가능성(워커 정본 → 미러) — 필드 타입이 좁혀지거나 어긋나면 컴파일 에러.
// (역방향은 계약이 아니다: 미러의 code 는 string 상위 타입으로 워커 enum 을 수용한다.)
const toCanonical = (r: ValidationResultDto): WorkerValidationResult => r;
const _errorToCanonical = (e: ValidationError): WorkerValidationError => e;
const _warningToCanonical = (w: ValidationWarning): WorkerValidationWarning => w;
const _metadataToCanonical = (m: PdfMetadata): WorkerPdfMetadata => m;

// ────────────────────────────────────────────────────────────────────────────
// 2) 런타임 shape 불변 단언
// ────────────────────────────────────────────────────────────────────────────

describe('S-1 ValidationResult 정본 계약 (worker DTO ↔ @storige/types 미러)', () => {
  /** 워커 발신 실물을 본뜬 대표 샘플 (enum·중첩 필드 포함) */
  const sample: ValidationResultDto = {
    isValid: false,
    errors: [
      {
        code: ErrorCode.PAGE_COUNT_INVALID,
        message: '페이지 수 오류',
        details: { expected: 4, actual: 3 },
        autoFixable: true,
        fixMethod: 'addBlankPages',
      },
    ],
    warnings: [
      {
        code: WarningCode.BLEED_MISSING,
        message: '재단 여백 없음',
        details: { bleed: 0 },
        autoFixable: true,
        fixMethod: 'extendBleed',
      },
    ],
    metadata: {
      pageCount: 3,
      pageSize: { width: 210, height: 297 },
      hasBleed: false,
      spreadInfo: {
        isSpread: false,
        score: 0,
        confidence: 'high',
        detectedType: 'single',
      },
    },
  };

  it('워커 DTO 값이 정본 타입(WorkerValidationResult)에 그대로 할당된다', () => {
    const canonical: WorkerValidationResult = toCanonical(sample);
    // 타입 전환은 값 무변형(동일 참조) — 런타임 바이트 불변의 최소 증명
    expect(canonical).toBe(sample);
  });

  it('런타임 최상위 shape 은 {isValid, errors, warnings, metadata} 4키 그대로다', () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(sample));
    expect(Object.keys(roundTripped as Record<string, unknown>).sort()).toEqual([
      'errors',
      'isValid',
      'metadata',
      'warnings',
    ]);
  });

  it('구형 shape 의 키({valid, fileInfo})는 발신물에 존재하지 않는다 (타입 거짓말 재발 방지)', () => {
    const roundTripped = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;
    expect(roundTripped).not.toHaveProperty('valid');
    expect(roundTripped).not.toHaveProperty('fileInfo');
  });

  it('에러/경고 항목 shape 이 정본 필드 그대로다 (code/message/details/autoFixable/fixMethod)', () => {
    const err = JSON.parse(JSON.stringify(sample.errors[0])) as Record<string, unknown>;
    expect(Object.keys(err).sort()).toEqual([
      'autoFixable',
      'code',
      'details',
      'fixMethod',
      'message',
    ]);
    // severity(구형 전용 필드)는 없다
    expect(err).not.toHaveProperty('severity');
  });
});

// 컴파일 타임 단언 상수들이 미사용 경고로 지워지지 않게 참조를 남긴다.
void _resultKeysMatch;
void _errorKeysMatch;
void _warningKeysMatch;
void _metadataKeysMatch;
void _errorToCanonical;
void _warningToCanonical;
void _metadataToCanonical;
