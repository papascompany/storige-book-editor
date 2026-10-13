/**
 * 파트너 잡 응답 형태(toPartnerJobView) — 정해진 키만 싣는 순수 함수.
 */
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { FILE_CORRUPTED_MESSAGE } from '../books/finalization-error-detail';
import {
  PARTNER_JOB_FAILURE_MESSAGE,
  PARTNER_JOB_FAILURE_MESSAGE_DEFAULT,
  PARTNER_JOB_VIEW_KEYS,
  type PartnerJobSource,
  toPartnerJobView,
} from './partner-job-view';

const CREATED = new Date('2026-10-13T01:02:03.000Z');
const DONE = new Date('2026-10-13T01:05:00.000Z');

/** 저장 잡 — 응답에 싣지 않는 키를 함께 가진다. */
function storedJob(over: Partial<PartnerJobSource> & Record<string, unknown> = {}): PartnerJobSource {
  return {
    id: 'job-1',
    jobType: WorkerJobType.SYNTHESIZE,
    status: WorkerJobStatus.COMPLETED,
    editSessionId: 'sess-1',
    sessionId: null,
    outputFileId: 'out-1',
    outputFileUrl: 'api://out-1',
    errorCode: null,
    createdAt: CREATED,
    completedAt: DONE,
    options: {
      contentTrim: { trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3, source: 'templateSet' },
      siteWebhook: false,
      editSessionId: 'sess-1',
      callbackUrl: 'https://partner.example/hook',
      orderOptions: { binding: 'perfect', spineWidthMm: 8 },
      coverUrl: 'api://cover-1',
      contentUrl: 'api://content-1',
    },
    result: { outputFileUrl: 'api://out-1', coverSizeValidation: { ok: true } },
    errorMessage: null,
    errorDetail: null,
    ...over,
    // 응답에 싣지 않는 키
    ...({
      fileId: 'file-1',
      inputFileUrl: 'api://file-1',
      siteId: 'site-1',
      pdfFileId: 'pdf-1',
      requestId: 'req-1',
      editSession: { id: 'sess-1', metadata: { a: 1 } },
    } as Record<string, unknown>),
  };
}

function validationJob(result: unknown, over: Partial<PartnerJobSource> = {}): PartnerJobSource {
  return storedJob({
    jobType: WorkerJobType.VALIDATE,
    status: WorkerJobStatus.FAILED,
    outputFileId: null,
    outputFileUrl: null,
    options: { siteWebhook: false },
    result,
    ...over,
  });
}

describe('toPartnerJobView — 파트너 잡 응답 형태', () => {
  it('응답 키는 정해진 목록과 같다', () => {
    const view = toPartnerJobView(storedJob());
    expect(Object.keys(view).sort()).toEqual([...PARTNER_JOB_VIEW_KEYS].sort());
    for (const key of ['fileId', 'inputFileUrl', 'siteId', 'pdfFileId', 'requestId', 'editSession']) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it('그대로 싣는 키는 저장값과 같고, 없으면 null 이다', () => {
    const view = toPartnerJobView(storedJob());
    expect(view).toMatchObject({
      id: 'job-1',
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.COMPLETED,
      editSessionId: 'sess-1',
      sessionId: null,
      outputFileId: 'out-1',
      outputFileUrl: 'api://out-1',
      errorCode: null,
    });
    expect(view.createdAt).toBe(CREATED);
    expect(view.completedAt).toBe(DONE);

    const sparse = toPartnerJobView({ id: 'j', jobType: WorkerJobType.CONVERT, status: WorkerJobStatus.PENDING });
    expect(Object.keys(sparse).sort()).toEqual([...PARTNER_JOB_VIEW_KEYS].sort());
    expect(sparse).toEqual({
      id: 'j',
      jobType: WorkerJobType.CONVERT,
      status: WorkerJobStatus.PENDING,
      editSessionId: null,
      sessionId: null,
      outputFileId: null,
      outputFileUrl: null,
      errorCode: null,
      createdAt: null,
      completedAt: null,
      options: null,
      result: null,
      errorMessage: null,
      errorDetail: null,
    });
  });

  it('options 에는 contentTrim·siteWebhook·editSessionId 만 남는다(값은 그대로)', () => {
    const job = storedJob();
    const view = toPartnerJobView(job);
    const stored = job.options as Record<string, unknown>;
    expect(view.options).toEqual({
      contentTrim: stored.contentTrim,
      siteWebhook: false,
      editSessionId: 'sess-1',
    });
    expect(view.options?.contentTrim).toBe(stored.contentTrim);

    expect(toPartnerJobView(storedJob({ options: { siteWebhook: false } })).options).toEqual({ siteWebhook: false });
  });

  it.each<[string, unknown]>([
    ['세 키가 모두 없음', { callbackUrl: 'https://partner.example/hook', orderOptions: {} }],
    ['빈 객체', {}],
    ['null', null],
    ['배열', ['contentTrim']],
    ['문자열', 'contentTrim'],
  ])('options 가 %s 이면 null 이다', (_label, options) => {
    expect(toPartnerJobView(storedJob({ options })).options).toBeNull();
  });

  it('검증 결과는 저장 형식 result.result 를 유지한다', () => {
    const stored = {
      result: {
        isValid: false,
        errors: [{ code: 'PAGE_COUNT_INVALID', message: '페이지 수가 4의 배수가 아닙니다', autoFixable: true, fixMethod: 'addBlankPages', details: { pageCount: 7 } }],
        warnings: [{ code: 'RESOLUTION_LOW', message: '해상도가 낮습니다', autoFixable: false, details: { dpi: 150 } }],
        metadata: { pageCount: 7, pageSize: { width: 148, height: 210 } },
        internalTrace: 'x',
      },
      extra: 'y',
    };
    const view = toPartnerJobView(validationJob(stored));
    expect(view.result).toEqual({
      result: {
        isValid: false,
        errors: [{ code: 'PAGE_COUNT_INVALID', message: '페이지 수가 4의 배수가 아닙니다', autoFixable: true, fixMethod: 'addBlankPages', details: { pageCount: 7 } }],
        warnings: [{ code: 'RESOLUTION_LOW', message: '해상도가 낮습니다', autoFixable: false, details: { dpi: 150 } }],
        metadata: { pageCount: 7, pageSize: { width: 148, height: 210 } },
      },
    });
  });

  it('감싸지 않은 검증 결과는 감싸지 않은 형식으로 남는다', () => {
    const view = toPartnerJobView(
      validationJob({ isValid: true, errors: [], warnings: [], metadata: { pageCount: 4 }, sessionId: 's' }),
    );
    expect(view.result).toEqual({ isValid: true, errors: [], warnings: [], metadata: { pageCount: 4 } });
  });

  it('검증 본문에 없는 키는 만들지 않는다(isValid 는 있을 때만)', () => {
    const view = toPartnerJobView(validationJob({ result: { errors: [{ code: 'A', message: 'a' }] } }));
    expect(view.result).toEqual({ result: { errors: [{ code: 'A', message: 'a' }] } });
  });

  it('검증 항목은 code·message·details·autoFixable·fixMethod 만 남고 객체가 아닌 항목은 빠진다', () => {
    const view = toPartnerJobView(
      validationJob({
        result: {
          isValid: false,
          errors: [{ code: 'BLEED_MISSING', message: '도련 없음', details: { mm: 0 }, autoFixable: true, fixMethod: 'extendBleed', stack: 'trace', raw: { x: 1 } }, 'oops', null],
          warnings: 'not-a-list',
        },
      }),
    );
    expect(view.result).toEqual({
      result: {
        isValid: false,
        errors: [{ code: 'BLEED_MISSING', message: '도련 없음', details: { mm: 0 }, autoFixable: true, fixMethod: 'extendBleed' }],
        warnings: [],
      },
    });
  });

  it('FILE_CORRUPTED 항목은 고정 문구이고 details 가 없다', () => {
    const view = toPartnerJobView(
      validationJob(
        {
          result: {
            isValid: false,
            errors: [{ code: 'FILE_CORRUPTED', message: 'PDF 파일을 읽을 수 없습니다: Invalid XRef at /tmp/x.pdf', details: { error: 'Invalid XRef' }, autoFixable: false }],
            warnings: [],
          },
        },
        { errorMessage: 'PDF 파일을 읽을 수 없습니다: Invalid XRef at /tmp/x.pdf' },
      ),
    );
    expect(view.result).toEqual({
      result: {
        isValid: false,
        errors: [{ code: 'FILE_CORRUPTED', message: FILE_CORRUPTED_MESSAGE, autoFixable: false }],
        warnings: [],
      },
    });
    expect(view.errorMessage).toBe(FILE_CORRUPTED_MESSAGE);
  });

  it('검증 결과가 없거나 객체가 아니면 result 는 null 이다', () => {
    expect(toPartnerJobView(validationJob(null)).result).toBeNull();
    expect(toPartnerJobView(validationJob(undefined)).result).toBeNull();
    expect(toPartnerJobView(validationJob('done')).result).toBeNull();
    expect(toPartnerJobView(validationJob([{ isValid: true }])).result).toBeNull();
  });

  it.each([WorkerJobType.SYNTHESIZE, WorkerJobType.CONVERT, WorkerJobType.RENDER_PAGES, WorkerJobType.CUTOUT])(
    '%s 잡의 result 는 저장값 그대로다',
    (jobType) => {
      const result = {
        result: { outputFileUrl: 'api://o', errors: [{ code: 'FILE_CORRUPTED', message: 'raw', details: { a: 1 } }] },
        coverSizeValidation: { ok: false, expected: 427.44 },
        outputFileId: 'o',
      };
      expect(toPartnerJobView(storedJob({ jobType, result })).result).toBe(result);
    },
  );

  it('errorMessage: 검증 잡은 남긴 오류 문구를 "; " 로 잇는다', () => {
    const view = toPartnerJobView(
      validationJob(
        {
          result: {
            isValid: false,
            errors: [
              { code: 'PAGE_COUNT_INVALID', message: '페이지 수 오류' },
              { code: 'FILE_CORRUPTED', message: '원문 예외 문구', details: { e: 1 } },
              { code: 'NO_MESSAGE' },
            ],
            warnings: [{ code: 'W', message: '경고는 잇지 않는다' }],
          },
        },
        { errorMessage: '페이지 수 오류; 원문 예외 문구' },
      ),
    );
    expect(view.errorMessage).toBe(`페이지 수 오류; ${FILE_CORRUPTED_MESSAGE}`);
  });

  it('errorMessage: errorCode 가 있고 INTERNAL_ERROR 가 아니면 저장값이다', () => {
    const synth = toPartnerJobView(
      storedJob({ status: WorkerJobStatus.FAILED, errorCode: 'PDF_LOAD_FAILED', errorMessage: '입력 PDF 를 열 수 없습니다' }),
    );
    expect(synth.errorMessage).toBe('입력 PDF 를 열 수 없습니다');
    const stalled = toPartnerJobView(
      validationJob(null, { errorCode: 'JOB_STALLED', errorMessage: '작업 처리가 반복해서 중단되었습니다' }),
    );
    expect(stalled.errorMessage).toBe('작업 처리가 반복해서 중단되었습니다');
  });

  it.each<[WorkerJobType, string | null]>([
    [WorkerJobType.VALIDATE, null],
    [WorkerJobType.CONVERT, null],
    [WorkerJobType.SYNTHESIZE, null],
    [WorkerJobType.SYNTHESIZE, 'INTERNAL_ERROR'],
    [WorkerJobType.RENDER_PAGES, null],
    [WorkerJobType.CUTOUT, ''],
  ])('errorCode 가 없거나 INTERNAL_ERROR 인 %s 실패는 유형별 고정 문구다(errorCode=%j)', (jobType, errorCode) => {
    const view = toPartnerJobView(
      storedJob({
        jobType,
        status: WorkerJobStatus.FAILED,
        errorCode,
        errorMessage: 'ENOENT: no such file /data/storage/x.pdf',
        result: null,
      }),
    );
    expect(view.errorMessage).toBe(PARTNER_JOB_FAILURE_MESSAGE[jobType]);
    expect(view.errorCode).toBe(errorCode);
  });

  it('합성 고정 문구는 합성 실패 기본 문구와 같고, 알 수 없는 유형은 기본 문구다', () => {
    expect(PARTNER_JOB_FAILURE_MESSAGE[WorkerJobType.SYNTHESIZE]).toBe('합성 처리 중 오류가 발생했습니다');
    const view = toPartnerJobView(
      storedJob({ jobType: 'LEGACY' as WorkerJobType, status: WorkerJobStatus.FAILED, errorMessage: 'raw' }),
    );
    expect(view.errorMessage).toBe(PARTNER_JOB_FAILURE_MESSAGE_DEFAULT);
  });

  it('errorMessage 가 null 이면 null, 빈 문자열이면 빈 문자열이다', () => {
    expect(toPartnerJobView(storedJob({ errorMessage: null })).errorMessage).toBeNull();
    expect(toPartnerJobView(storedJob({ errorMessage: undefined })).errorMessage).toBeNull();
    expect(toPartnerJobView(storedJob({ errorMessage: '' })).errorMessage).toBe('');
  });

  it('errorDetail 은 원시값 키만 남기고, 남는 키가 없으면 null 이다', () => {
    const view = toPartnerJobView(
      storedJob({
        status: WorkerJobStatus.FAILED,
        errorCode: 'SYNTHESIS_FAILED',
        errorDetail: { httpStatus: 502, retryable: false, stage: 'cover', note: null, jobData: { url: 'x' }, list: [1] },
      }),
    );
    expect(view.errorDetail).toEqual({ httpStatus: 502, retryable: false, stage: 'cover', note: null });
    expect(toPartnerJobView(storedJob({ errorDetail: { stack: { a: 1 } } })).errorDetail).toBeNull();
    expect(toPartnerJobView(storedJob({ errorDetail: null })).errorDetail).toBeNull();
    expect(toPartnerJobView(storedJob({ errorDetail: 'text' })).errorDetail).toBeNull();
  });

  it('입력 객체를 바꾸지 않고, 결과를 다시 넣어도 같다', () => {
    const job = validationJob(
      { result: { isValid: false, errors: [{ code: 'FILE_CORRUPTED', message: 'raw', details: { a: 1 } }], warnings: [] } },
      { errorMessage: 'raw', errorDetail: { a: 1, b: { c: 2 } } },
    );
    const before = JSON.stringify(job);
    const once = toPartnerJobView(job);
    expect(JSON.stringify(job)).toBe(before);
    expect(toPartnerJobView(once)).toEqual(once);
  });
});
