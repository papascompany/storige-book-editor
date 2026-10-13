/**
 * 최종화 실패 진단(errorDetail) 형식 — 저장 값과 응답 투영.
 */
import { WorkerJobStatus } from '@storige/types';
import {
  FILE_CORRUPTED_MESSAGE,
  FINALIZATION_INTERNAL_REASON,
  internalFailureDetail,
  jobFailureDetail,
  toPublicErrorDetail,
} from './finalization-error-detail';

/** 워커 검증 잡 결과와 같은 모양 — 프로세서가 { result } 로 한 번 감싸 저장한다. */
const validationJobResult = (): Record<string, unknown> => ({
  result: {
    isValid: false,
    errors: [
      {
        code: 'FILE_CORRUPTED',
        message: '파일 처리 중 오류가 발생했습니다: ENOENT /app/storage/uploads/x.pdf',
        details: { actual: 'ENOENT /app/storage/uploads/x.pdf' },
        autoFixable: false,
      },
      {
        code: 'PAGE_COUNT_INVALID',
        message: '페이지 수가 맞지 않습니다',
        details: { expected: 40, actual: 38 },
        autoFixable: true,
        fixMethod: 'addBlankPages',
        metadata: { note: 'x' },
      },
      'bad',
      null,
    ],
    warnings: [
      { code: 'LOW_RESOLUTION', message: '해상도가 낮습니다', details: { minDpi: 72 }, autoFixable: false },
    ],
    metadata: { pageCount: 38, pageSize: { width: 148, height: 210 } },
  },
});

describe('finalization-error-detail', () => {
  it('내부 실패는 고정 사유 코드와 문구를 돌려준다', () => {
    expect(internalFailureDetail('TRANSITION_FAILED')).toEqual({
      code: 'TRANSITION_FAILED',
      reason: FINALIZATION_INTERNAL_REASON.TRANSITION_FAILED,
    });
    expect(internalFailureDetail('OUTPUT_URL_MISSING').reason).toBe(
      FINALIZATION_INTERNAL_REASON.OUTPUT_URL_MISSING,
    );
    expect(internalFailureDetail('OUTPUT_REGISTER_FAILED').reason).toBe(
      FINALIZATION_INTERNAL_REASON.OUTPUT_REGISTER_FAILED,
    );
  });

  it('검증 오류 항목은 code·message·autoFixable·fixMethod만 남긴다', () => {
    const detail = jobFailureDetail('validate', {
      status: WorkerJobStatus.FAILED,
      result: validationJobResult(),
    });
    expect(detail).toEqual({
      stage: 'validate',
      jobStatus: 'FAILED',
      jobErrorCode: null,
      result: {
        errors: [
          { code: 'FILE_CORRUPTED', message: FILE_CORRUPTED_MESSAGE, autoFixable: false },
          {
            code: 'PAGE_COUNT_INVALID',
            message: '페이지 수가 맞지 않습니다',
            autoFixable: true,
            fixMethod: 'addBlankPages',
          },
        ],
        warnings: [{ code: 'LOW_RESOLUTION', message: '해상도가 낮습니다', autoFixable: false }],
      },
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('/app/storage/uploads/x.pdf');
    expect(serialized).not.toContain('details');
    expect(serialized).not.toContain('metadata');
    expect(serialized).not.toContain('isValid');
  });

  it('FILE_CORRUPTED 항목의 message는 고정 안내 문구다', () => {
    const detail = jobFailureDetail('validate', {
      status: WorkerJobStatus.FAILED,
      result: { errors: [{ code: 'FILE_CORRUPTED', message: 'Invalid PDF structure at offset 12', autoFixable: false }] },
    });
    expect(detail.result?.errors).toEqual([
      { code: 'FILE_CORRUPTED', message: FILE_CORRUPTED_MESSAGE, autoFixable: false },
    ]);
  });

  it('null·비객체 입력은 result null로 돌려준다', () => {
    for (const result of [null, undefined, 'oops', 42, ['a']]) {
      expect(jobFailureDetail('validate', { status: WorkerJobStatus.FAILED, result })).toEqual({
        stage: 'validate',
        jobStatus: 'FAILED',
        jobErrorCode: null,
        result: null,
      });
    }
    expect(toPublicErrorDetail(null)).toBeNull();
    expect(toPublicErrorDetail('text')).toBeNull();
    expect(toPublicErrorDetail({ unknown: 1 })).toBeNull();
  });

  it('합성 잡 실패는 결과와 관계없이 result null로 돌려준다', () => {
    expect(
      jobFailureDetail('compose', { status: WorkerJobStatus.FAILED, result: { errors: [{ code: 'X' }] } }),
    ).toEqual({ stage: 'compose', jobStatus: 'FAILED', jobErrorCode: null, result: null });
  });

  it('같은 입력을 두 번 투영해도 결과가 같다', () => {
    const stored = [
      jobFailureDetail('validate', { status: WorkerJobStatus.FIXABLE, result: validationJobResult() }),
      jobFailureDetail('compose', { status: WorkerJobStatus.FAILED, result: null }),
      internalFailureDetail('OUTPUT_REGISTER_FAILED'),
    ];
    for (const s of stored) {
      const once = toPublicErrorDetail(s);
      expect(once).toEqual(s);
      expect(toPublicErrorDetail(once)).toEqual(once);
    }
  });

  it('예전 {reason} 행은 접두어에 맞는 사유 코드와 고정 문구로 읽힌다', () => {
    expect(toPublicErrorDetail({ reason: '전이 예외: connect ECONNREFUSED db:3306' })).toEqual(
      internalFailureDetail('TRANSITION_FAILED'),
    );
    expect(toPublicErrorDetail({ reason: 'synthesis output url 부재' })).toEqual(
      internalFailureDetail('OUTPUT_URL_MISSING'),
    );
    expect(toPublicErrorDetail({ reason: '산출물 등록 실패: EACCES /app/storage/outputs' })).toEqual(
      internalFailureDetail('OUTPUT_REGISTER_FAILED'),
    );
    expect(toPublicErrorDetail({ reason: 'something else' })).toEqual(
      internalFailureDetail('TRANSITION_FAILED'),
    );
  });

  it('예전 {jobStatus, result} 행은 지정한 단계로 투영해 읽힌다', () => {
    const legacyValidate = { jobStatus: 'FAILED', result: validationJobResult() };
    const projected = toPublicErrorDetail(legacyValidate);
    expect(projected).toEqual(
      jobFailureDetail('validate', { status: WorkerJobStatus.FAILED, result: validationJobResult() }),
    );
    expect(JSON.stringify(projected)).not.toContain('/app/storage/uploads/x.pdf');

    expect(toPublicErrorDetail({ jobStatus: 'FAILED', result: null }, 'compose')).toEqual({
      stage: 'compose',
      jobStatus: 'FAILED',
      jobErrorCode: null,
      result: null,
    });
  });

  it('저장된 사유 코드 행의 문구는 코드의 고정 문구로 읽힌다', () => {
    expect(toPublicErrorDetail({ code: 'OUTPUT_URL_MISSING', reason: 'changed text' })).toEqual(
      internalFailureDetail('OUTPUT_URL_MISSING'),
    );
  });

  describe('jobErrorCode — 잡의 errorCode', () => {
    it('합성 잡 PDF_LOAD_FAILED 실패는 그 코드를 싣는다', () => {
      expect(
        jobFailureDetail('compose', { status: WorkerJobStatus.FAILED, result: null, errorCode: 'PDF_LOAD_FAILED' }),
      ).toEqual({ stage: 'compose', jobStatus: 'FAILED', jobErrorCode: 'PDF_LOAD_FAILED', result: null });
    });

    it('오류 코드가 없는 검증 FIXABLE 은 null 이다', () => {
      const detail = jobFailureDetail('validate', {
        status: WorkerJobStatus.FIXABLE,
        result: validationJobResult(),
        errorCode: null,
      });
      expect(detail.jobErrorCode).toBeNull();
      expect(detail.result?.errors).toHaveLength(2);
    });

    it('JOB_STALLED 로 끝난 잡은 그 코드를 싣는다(두 단계 공통)', () => {
      for (const stage of ['validate', 'compose'] as const) {
        expect(
          jobFailureDetail(stage, { status: WorkerJobStatus.FAILED, result: null, errorCode: 'JOB_STALLED' }).jobErrorCode,
        ).toBe('JOB_STALLED');
      }
    });

    it.each<[string, unknown]>([
      ['소문자', 'pdf_load_failed'],
      ['공백 포함', 'PDF LOAD'],
      ['숫자 시작', '1ERROR'],
      ['한 글자', 'E'],
      ['51자', `E${'X'.repeat(50)}`],
      ['빈 문자열', ''],
      ['문자열이 아님', 42],
    ])('형식이 다른 값(%s)은 null 이다', (_label, errorCode) => {
      expect(
        jobFailureDetail('compose', {
          status: WorkerJobStatus.FAILED,
          result: null,
          errorCode: errorCode as string,
        }).jobErrorCode,
      ).toBeNull();
      expect(
        toPublicErrorDetail({ stage: 'compose', jobStatus: 'FAILED', jobErrorCode: errorCode, result: null }),
      ).toEqual({ stage: 'compose', jobStatus: 'FAILED', jobErrorCode: null, result: null });
    });

    it('50자 코드는 싣는다', () => {
      const code = `E${'X'.repeat(49)}`;
      expect(jobFailureDetail('compose', { status: WorkerJobStatus.FAILED, errorCode: code }).jobErrorCode).toBe(code);
    });

    it('jobErrorCode 가 없던 때 저장된 행은 null 로 읽힌다', () => {
      expect(toPublicErrorDetail({ stage: 'compose', jobStatus: 'FAILED', result: null })).toEqual({
        stage: 'compose',
        jobStatus: 'FAILED',
        jobErrorCode: null,
        result: null,
      });
      expect(toPublicErrorDetail({ jobStatus: 'FAILED', result: null }, 'compose')).toEqual({
        stage: 'compose',
        jobStatus: 'FAILED',
        jobErrorCode: null,
        result: null,
      });
    });

    it('코드를 실은 진단을 두 번 투영해도 같다', () => {
      const stored = jobFailureDetail('validate', {
        status: WorkerJobStatus.FAILED,
        result: validationJobResult(),
        errorCode: 'JOB_STALLED',
      });
      const once = toPublicErrorDetail(stored);
      expect(once).toEqual(stored);
      expect(toPublicErrorDetail(once)).toEqual(once);
    });
  });
});
