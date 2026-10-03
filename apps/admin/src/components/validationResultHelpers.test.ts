// 검증 결과 표시 헬퍼 — vitest (node 환경)
import { describe, it, expect } from 'vitest';
import { WorkerJobStatus, WorkerJobType, type WorkerJob } from '@storige/types';
import {
  canExpandValidationResult,
  countInfoWarnings,
  errorCodeLabel,
  extractValidationResult,
  formatMmSize,
  formatMmSizeOrDash,
  isInfoWarning,
  toMmSize,
  trimBoxBasisDetail,
  trimBoxBasisDetailText,
  validationForJob,
  warningCodeLabel,
} from './validationResultHelpers';

// 워커가 TrimBox 기준으로 판형을 통과시킬 때 남기는 경고 형태(mm)
const trimBoxWarning = {
  code: 'TRIMBOX_SIZE_BASIS',
  message: '재단 크기(TrimBox) 기준으로 판형을 확인했습니다.',
  details: {
    sizeBasis: 'trimBox',
    trimBox: { width: 210, height: 297 },
    mediaBox: { width: 236, height: 323 },
  },
  autoFixable: false,
};

const workerResult = {
  isValid: true,
  errors: [],
  warnings: [trimBoxWarning],
  metadata: {
    pageCount: 4,
    pageSize: { width: 236, height: 323 },
    hasBleed: true,
    bleedSize: 3,
    colorMode: 'CMYK',
    trimBox: { width: 210, height: 297 },
  },
};

describe('코드 라벨', () => {
  it('TRIMBOX_SIZE_BASIS 는 정보성 라벨로, 기존 코드는 기존 라벨로 보인다', () => {
    expect(warningCodeLabel('TRIMBOX_SIZE_BASIS')).toBe('재단 크기(TrimBox) 기준 판형');
    expect(warningCodeLabel('BLEED_MISSING')).toBe('재단 여백 없음');
    expect(errorCodeLabel('SIZE_MISMATCH')).toBe('사이즈 불일치');
  });

  it('라벨이 없는 코드는 원 코드 그대로 돌려준다', () => {
    expect(warningCodeLabel('NEW_CODE')).toBe('NEW_CODE');
    expect(errorCodeLabel('NEW_CODE')).toBe('NEW_CODE');
    expect(warningCodeLabel('constructor')).toBe('constructor');
    expect(errorCodeLabel('toString')).toBe('toString');
  });

  it('정보성 경고는 TRIMBOX_SIZE_BASIS 만 해당하고 개수를 센다', () => {
    expect(isInfoWarning('TRIMBOX_SIZE_BASIS')).toBe(true);
    expect(isInfoWarning('BLEED_MISSING')).toBe(false);
    expect(countInfoWarnings([{ code: 'TRIMBOX_SIZE_BASIS' }, { code: 'BLEED_MISSING' }])).toBe(1);
  });
});

describe('크기 해석·표시', () => {
  it('width·height 가 유한한 양수일 때만 크기로 인정한다', () => {
    expect(toMmSize({ width: 210, height: 297 })).toEqual({ width: 210, height: 297 });
    for (const value of [
      null,
      undefined,
      'x',
      [210, 297],
      { width: '210', height: 297 },
      { width: Number.NaN, height: 297 },
      { width: Number.POSITIVE_INFINITY, height: 297 },
      { width: 0, height: 297 },
      { width: -210, height: 297 },
      { width: 210 },
    ]) {
      expect(toMmSize(value)).toBeNull();
    }
  });

  it('mm 크기를 소수 1자리로 표시하고, 형식이 맞지 않으면 - 로 표시한다', () => {
    expect(formatMmSize({ width: 210, height: 297 })).toBe('210.0 x 297.0 mm');
    expect(formatMmSize({ width: 209.96, height: 296.94 })).toBe('210.0 x 296.9 mm');
    expect(formatMmSizeOrDash({ width: '210', height: 297 })).toBe('-');
    expect(formatMmSizeOrDash(undefined)).toBe('-');
  });
});

describe('trimBoxBasisDetail', () => {
  it('워커 경고 형태에서 재단 크기와 원본 페이지 크기를 꺼낸다', () => {
    const detail = trimBoxBasisDetail(trimBoxWarning);
    expect(detail).toEqual({ trimBox: { width: 210, height: 297 }, mediaBox: { width: 236, height: 323 } });
    expect(detail && trimBoxBasisDetailText(detail)).toBe(
      '재단 크기 210.0 x 297.0 mm · 원본 페이지(MediaBox) 236.0 x 323.0 mm',
    );
  });

  it('mediaBox 가 없으면 재단 크기 구절만 만든다', () => {
    const detail = trimBoxBasisDetail({ code: 'TRIMBOX_SIZE_BASIS', details: { trimBox: { width: 210, height: 297 } } });
    expect(detail).toEqual({ trimBox: { width: 210, height: 297 }, mediaBox: null });
    expect(detail && trimBoxBasisDetailText(detail)).toBe('재단 크기 210.0 x 297.0 mm');
  });

  it('다른 코드이거나 details 가 없거나 형식이 맞지 않으면 null 이다', () => {
    expect(trimBoxBasisDetail({ ...trimBoxWarning, code: 'BLEED_MISSING' })).toBeNull();
    expect(trimBoxBasisDetail({ code: 'TRIMBOX_SIZE_BASIS' })).toBeNull();
    expect(trimBoxBasisDetail({ code: 'TRIMBOX_SIZE_BASIS', details: 'x' })).toBeNull();
    expect(trimBoxBasisDetail({ code: 'TRIMBOX_SIZE_BASIS', details: { trimBox: { width: '210', height: 297 } } })).toBeNull();
  });
});

describe('extractValidationResult', () => {
  it('워커가 감싸 저장한 결과와 감싸지 않은 결과를 같은 값으로 꺼낸다', () => {
    const wrapped = extractValidationResult({ result: workerResult }, 'COMPLETED');
    expect(wrapped).toEqual({
      isValid: true,
      errors: [],
      warnings: [trimBoxWarning],
      metadata: workerResult.metadata,
    });
    expect(extractValidationResult(workerResult, 'COMPLETED')).toEqual(wrapped);
  });

  it('결과 형식을 알 수 없으면 null 이다', () => {
    for (const raw of [null, undefined, 'x', 1, [], {}, { outputFileUrl: 'x' }, { result: 'x' }]) {
      expect(extractValidationResult(raw, 'COMPLETED')).toBeNull();
    }
  });

  it('isValid 가 없으면 상태와 에러 수로 판정한다', () => {
    expect(extractValidationResult({ errors: [] }, 'COMPLETED')?.isValid).toBe(true);
    expect(extractValidationResult({ errors: [] }, 'FIXABLE')?.isValid).toBe(false);
    expect(
      extractValidationResult({ errors: [{ code: 'SIZE_MISMATCH', message: 'm' }] }, 'COMPLETED')?.isValid,
    ).toBe(false);
    expect(extractValidationResult({ isValid: 'yes', errors: [] }, 'COMPLETED')?.isValid).toBe(true);
  });

  it('배열이 아닌 errors·warnings 는 빈 배열, 객체가 아닌 metadata 는 빈 객체로 둔다', () => {
    const view = extractValidationResult({ errors: 'x', warnings: { code: 'A' }, metadata: 'x' }, 'COMPLETED');
    expect(view).toEqual({ isValid: true, errors: [], warnings: [], metadata: {} });
  });

  it('code 가 문자열인 객체 원소만 남기고 문자열이 아닌 message·fixMethod 는 버린다', () => {
    const view = extractValidationResult(
      {
        isValid: false,
        errors: [null, 1, 'SIZE_MISMATCH', { code: 1 }, { code: 'SIZE_MISMATCH', message: { text: 'x' }, fixMethod: 3 }],
        warnings: [{ code: 'X', message: 'ok', details: 'x', autoFixable: 'true', fixMethod: 'resize' }],
      },
      'FAILED',
    );
    expect(view?.errors).toEqual([{ code: 'SIZE_MISMATCH', message: '', details: {}, autoFixable: false }]);
    expect(view?.warnings).toEqual([
      { code: 'X', message: 'ok', details: {}, autoFixable: false, fixMethod: 'resize' },
    ]);
  });

  it('메타데이터는 타입이 맞는 필드만 옮긴다', () => {
    const view = extractValidationResult(
      {
        metadata: {
          pageCount: '4',
          pageSize: { width: '210', height: 297 },
          hasBleed: 'yes',
          bleedSize: Number.NaN,
          colorMode: { name: 'CMYK' },
          trimBox: { width: 0, height: 297 },
          resolution: 300,
        },
      },
      'COMPLETED',
    );
    expect(view?.metadata).toEqual({ resolution: 300 });
  });
});

/** API 가 돌려주는 런타임 실물(감싼 형태 등)을 그대로 담은 잡 */
function job(
  jobType: WorkerJobType,
  status: WorkerJobStatus,
  result: unknown,
): Pick<WorkerJob, 'jobType' | 'status' | 'result'> {
  return { jobType, status, result: result as WorkerJob['result'] };
}

describe('validationForJob', () => {
  it('VALIDATE 잡의 결과만 구조화 카드 대상으로 꺼낸다', () => {
    expect(validationForJob(job(WorkerJobType.VALIDATE, WorkerJobStatus.COMPLETED, { result: workerResult }))).not.toBeNull();
    expect(
      validationForJob(job(WorkerJobType.SYNTHESIZE, WorkerJobStatus.COMPLETED, { result: workerResult })),
    ).toBeNull();
    expect(validationForJob(job(WorkerJobType.VALIDATE, WorkerJobStatus.PROCESSING, undefined))).toBeNull();
    expect(validationForJob(job(WorkerJobType.VALIDATE, WorkerJobStatus.COMPLETED, null))).toBeNull();
  });

  it('isValid 가 없는 결과는 잡 상태로 판정한다', () => {
    const view = validationForJob(
      job(WorkerJobType.VALIDATE, WorkerJobStatus.FIXABLE, { result: { errors: [], warnings: [] } }),
    );
    expect(view?.isValid).toBe(false);
  });
});

describe('canExpandValidationResult', () => {
  it('결과가 남는 상태의 VALIDATE 행만 펼칠 수 있다', () => {
    for (const status of ['COMPLETED', 'FIXABLE', 'FAILED']) {
      expect(canExpandValidationResult({ jobType: 'VALIDATE', status })).toBe(true);
    }
    for (const status of ['PENDING', 'PROCESSING']) {
      expect(canExpandValidationResult({ jobType: 'VALIDATE', status })).toBe(false);
    }
    expect(canExpandValidationResult({ jobType: 'SYNTHESIZE', status: 'COMPLETED' })).toBe(false);
  });
});
