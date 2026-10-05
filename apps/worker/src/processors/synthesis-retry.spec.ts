/**
 * JD-2 (2026-10) — 합성 실패 시도 판정(synthesis-retry) 고정.
 *
 * 잠그는 계약:
 *  1. 시도 정보: bull 4.x 규칙(attemptsMade = 앞서 실패한 시도 수, attempts 미지정 = 1). 읽을 수 없으면 최종.
 *  2. 분류: 재시도 DomainError 코드 5종, 나머지 ErrorCodes 는 재시도 없음. 408·425·429·5xx·응답 없음은 재시도.
 *  3. 판정: retry / fail, FAILED PATCH 때 discard 호출 여부, [SYNTH_RETRY] 로그 형식(오류 메시지·URL 없음).
 *  4. 설치된 bull 의 backoff·discard 동작.
 *  5. 합성 FAILED payload(buildSynthesisFailedFields): 워커 오류 코드 또는 SYNTHESIS_FAILED, 허용 키 원시값 상세.
 */
import * as fs from 'fs';
import { DomainError, ErrorCodes } from '../common/errors';
import {
  buildSynthesisFailedFields,
  classifySynthesisError,
  decideSynthesisFailure,
  formatSynthRetryLog,
  getAttemptInfo,
  isRetryableHttpStatus,
  shouldDiscardOnFail,
  shouldLogSynthRetry,
  SYNTHESIS_FAILED_CODE,
  SYNTHESIS_FAILED_MESSAGE,
  SYNTHESIS_NON_RETRYABLE_DOMAIN_CODES,
  SYNTHESIS_RETRYABLE_DOMAIN_CODES,
} from './synthesis-retry';

describe('getAttemptInfo', () => {
  it.each([
    [{ attemptsMade: 0, opts: { attempts: 3 } }, { attempt: 1, maxAttempts: 3, isFinal: false, reliable: true }],
    [{ attemptsMade: 1, opts: { attempts: 3 } }, { attempt: 2, maxAttempts: 3, isFinal: false, reliable: true }],
    [{ attemptsMade: 2, opts: { attempts: 3 } }, { attempt: 3, maxAttempts: 3, isFinal: true, reliable: true }],
    [{ opts: { attempts: 3 } }, { attempt: 1, maxAttempts: 3, isFinal: false, reliable: true }],
    [{ attemptsMade: 0 }, { attempt: 1, maxAttempts: 1, isFinal: true, reliable: true }],
    [{ attemptsMade: 0, opts: {} }, { attempt: 1, maxAttempts: 1, isFinal: true, reliable: true }],
    [{ attemptsMade: 0, opts: { attempts: 1 } }, { attempt: 1, maxAttempts: 1, isFinal: true, reliable: true }],
  ])('%j → %j', (job, expected) => {
    expect(getAttemptInfo(job)).toEqual(expected);
  });

  it('job 이 없으면 1/1 최종', () => {
    expect(getAttemptInfo(undefined)).toEqual({ attempt: 1, maxAttempts: 1, isFinal: true, reliable: true });
    expect(getAttemptInfo(null)).toEqual({ attempt: 1, maxAttempts: 1, isFinal: true, reliable: true });
  });

  it.each([NaN, 0, '3', -1, 2.5, null])('opts.attempts=%p 는 읽을 수 없는 값 → maxAttempts 1·최종', (attempts) => {
    const info = getAttemptInfo({ attemptsMade: 0, opts: { attempts } });
    expect(info).toEqual({ attempt: 1, maxAttempts: 1, isFinal: true, reliable: false });
  });

  it.each([-1, 1.5, 'x', NaN])('attemptsMade=%p 는 읽을 수 없는 값 → 최종', (attemptsMade) => {
    const info = getAttemptInfo({ attemptsMade, opts: { attempts: 3 } });
    expect(info.isFinal).toBe(true);
    expect(info.reliable).toBe(false);
  });
});

describe('classifySynthesisError', () => {
  const RETRYABLE: string[] = [
    ErrorCodes.FILE_DOWNLOAD_FAILED,
    ErrorCodes.SPLIT_VERIFICATION_FAILED,
    ErrorCodes.EMPTY_OUTPUT_FILE,
    ErrorCodes.SERVICE_UNAVAILABLE,
    ErrorCodes.INTERNAL_ERROR,
  ];
  const NON_RETRYABLE = Object.values(ErrorCodes).filter((c) => !RETRYABLE.includes(c));

  it.each(RETRYABLE)('DomainError %s → 재시도', (code) => {
    expect(classifySynthesisError(new DomainError(code, 'm'))).toEqual({
      retryable: true,
      kind: 'domain',
      code,
      httpStatus: null,
    });
  });

  it.each(NON_RETRYABLE)('DomainError %s → 재시도 없음', (code) => {
    const c = classifySynthesisError(new DomainError(code, 'm'));
    expect(c.retryable).toBe(false);
    expect(c.kind).toBe('domain');
    expect(c.code).toBe(code);
  });

  it('ErrorCodes 의 모든 값이 두 집합 중 정확히 하나에 들어 있다', () => {
    for (const code of Object.values(ErrorCodes)) {
      const inRetry = SYNTHESIS_RETRYABLE_DOMAIN_CODES.has(code);
      const inNon = SYNTHESIS_NON_RETRYABLE_DOMAIN_CODES.has(code);
      expect([code, inRetry !== inNon]).toEqual([code, true]);
    }
    expect(SYNTHESIS_RETRYABLE_DOMAIN_CODES.size + SYNTHESIS_NON_RETRYABLE_DOMAIN_CODES.size).toBe(
      Object.values(ErrorCodes).length,
    );
  });

  it('목록에 없는 DomainError 코드 → 재시도 없음', () => {
    expect(classifySynthesisError(new DomainError('X', 'm')).retryable).toBe(false);
  });

  it('name 이 DomainError 이고 code 가 문자열인 객체도 DomainError 로 판정', () => {
    const like = { name: 'DomainError', code: ErrorCodes.PAGE_COUNT_MISMATCH, message: 'm' };
    expect(classifySynthesisError(like)).toEqual({
      retryable: false,
      kind: 'domain',
      code: ErrorCodes.PAGE_COUNT_MISMATCH,
      httpStatus: null,
    });
  });

  it('DomainError detail.httpStatus 를 읽는다', () => {
    const err = new DomainError(ErrorCodes.SERVICE_UNAVAILABLE, 'm', { phase: 'file-lookup', httpStatus: 503 });
    expect(classifySynthesisError(err)).toEqual({
      retryable: true,
      kind: 'domain',
      code: ErrorCodes.SERVICE_UNAVAILABLE,
      httpStatus: 503,
    });
  });

  it.each([400, 401, 403, 404, 410, 422])('HTTP %i → 재시도 없음', (status) => {
    expect(classifySynthesisError({ response: { status } })).toEqual({
      retryable: false,
      kind: 'http',
      code: null,
      httpStatus: status,
    });
  });

  it.each([408, 425, 429, 500, 502, 503, 504])('HTTP %i → 재시도', (status) => {
    const c = classifySynthesisError(Object.assign(new Error('x'), { code: 'ERR_BAD_RESPONSE', response: { status } }));
    expect(c).toEqual({ retryable: true, kind: 'http', code: 'ERR_BAD_RESPONSE', httpStatus: status });
  });

  it('Node 시스템 오류(code ENOENT) → 재시도, kind other', () => {
    expect(classifySynthesisError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toEqual({
      retryable: true,
      kind: 'other',
      code: 'ENOENT',
      httpStatus: null,
    });
  });

  it.each(['str', null, undefined, 42, new Error('plain')])('그 밖의 값 %p → 재시도', (value) => {
    const c = classifySynthesisError(value);
    expect(c.retryable).toBe(true);
    expect(c.kind).toBe('other');
  });

  it('응답 중단(ERR_BAD_RESPONSE, 상태 200)은 재시도', () => {
    const aborted = Object.assign(new Error('stream has been aborted'), {
      code: 'ERR_BAD_RESPONSE',
      response: { status: 200 },
    });
    expect(classifySynthesisError(aborted)).toEqual({
      retryable: true,
      kind: 'http',
      code: 'ERR_BAD_RESPONSE',
      httpStatus: 200,
    });
  });

  it.each([ErrorCodes.PDF_LOAD_FAILED, ErrorCodes.FILE_NOT_FOUND, ErrorCodes.INPUT_URL_REJECTED])(
    '합성 입력 오류 %s → 재시도 없음',
    (code) => {
      expect(classifySynthesisError(new DomainError(code, 'm', { input: 'cover' })).retryable).toBe(false);
    },
  );

  it('로그용 code 는 대문자·숫자·밑줄 형식만 남긴다', () => {
    expect(classifySynthesisError(Object.assign(new Error('x'), { code: 'bad code/with path' })).code).toBeNull();
  });

  it('isRetryableHttpStatus: 408·425·429·5xx 재시도, 그 밖의 4xx 재시도 없음', () => {
    expect([408, 425, 429, 500, 503].map(isRetryableHttpStatus)).toEqual([true, true, true, true, true]);
    expect([400, 401, 403, 404, 409].map(isRetryableHttpStatus)).toEqual([false, false, false, false, false]);
  });
});

describe('decideSynthesisFailure', () => {
  const retryable = new Error('socket hang up');
  const nonRetryable = new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, '페이지 수 불일치');

  it.each([
    ['재시도 가능 + 남은 시도', retryable, 0, 'retry', 'retryable', false, false],
    ['재시도 가능 + 마지막 시도', retryable, 2, 'fail', 'exhausted', false, true],
    ['재시도 불가 + 남은 시도', nonRetryable, 0, 'fail', 'non-retryable', true, true],
    ['재시도 불가 + 마지막 시도', nonRetryable, 2, 'fail', 'non-retryable', false, true],
  ])('%s (attempts 3)', (_t, err, attemptsMade, action, reason, discard, callDiscard) => {
    const d = decideSynthesisFailure({ attemptsMade, opts: { attempts: 3 } }, err);
    expect([d.action, d.reason, d.discard]).toEqual([action, reason, discard]);
    expect(shouldDiscardOnFail(d)).toBe(callDiscard);
    expect(shouldLogSynthRetry(d)).toBe(true);
  });

  it('attempts 미지정 잡: 모든 실패가 최종, discard 호출 없음, [SYNTH_RETRY] 로그 없음', () => {
    for (const err of [retryable, nonRetryable]) {
      const d = decideSynthesisFailure({ attemptsMade: 0 }, err);
      expect(d.action).toBe('fail');
      expect(d.discard).toBe(false);
      expect(shouldDiscardOnFail(d)).toBe(false);
      expect(shouldLogSynthRetry(d)).toBe(false);
    }
  });

  it('시도 정보를 읽을 수 없으면 FAILED 로 판정하고 discard 를 호출한다', () => {
    const d = decideSynthesisFailure({ attemptsMade: 0, opts: { attempts: 'x' } }, retryable);
    expect([d.action, d.reason, d.discard]).toEqual(['fail', 'exhausted', true]);
    expect(shouldDiscardOnFail(d)).toBe(true);
  });

  it('판정 중 예외가 나면 최종 FAILED + discard 로 판정한다', () => {
    const hostile = {
      get attemptsMade(): number {
        throw new Error('getter');
      },
    };
    const d = decideSynthesisFailure(hostile, retryable);
    expect([d.action, d.reason, d.discard]).toEqual(['fail', 'exhausted', true]);
    expect(shouldDiscardOnFail(d)).toBe(true);
  });
});

describe('formatSynthRetryLog', () => {
  it('정해진 키만 남기고 오류 메시지·URL 은 넣지 않는다', () => {
    const err = Object.assign(new Error('GET https://files.example.com/secret/path.pdf failed'), {
      response: { status: 503 },
    });
    const d = decideSynthesisFailure({ attemptsMade: 0, opts: { attempts: 3 } }, err);
    const line = formatSynthRetryLog({ jobId: 'job-1', queueJobId: 7, mode: 'merge', decision: d, outcome: 'retry' });
    expect(line).toBe(
      '[SYNTH_RETRY] jobId=job-1 queueJobId=7 mode=merge attempt=1/3 action=retry reason=retryable code=- http=503 discard=no',
    );
    expect(line).not.toContain('https://');
    expect(line).not.toContain('failed');
  });

  it('fail·completed 출력', () => {
    const d = decideSynthesisFailure(
      { attemptsMade: 0, opts: { attempts: 3 } },
      new DomainError(ErrorCodes.INVALID_OUTPUT_OPTIONS, 'm'),
    );
    expect(formatSynthRetryLog({ jobId: 'j', queueJobId: undefined, mode: 'split', decision: d, outcome: 'fail' })).toBe(
      '[SYNTH_RETRY] jobId=j queueJobId=- mode=split attempt=1/3 action=fail reason=non-retryable code=INVALID_OUTPUT_OPTIONS http=- discard=yes',
    );
    expect(formatSynthRetryLog({ jobId: 'j', queueJobId: 'q', mode: 'split', decision: d, outcome: 'completed' })).toBe(
      '[SYNTH_RETRY] jobId=j queueJobId=q mode=split attempt=1/3 action=completed reason=completed-marker code=INVALID_OUTPUT_OPTIONS http=- discard=no',
    );
  });
});

describe('설치된 bull 동작', () => {
  it('exponential 30000 대기: 1차 실패 뒤 30000ms, 2차 실패 뒤 90000ms', async () => {
    const backoffs: { calculate: (...args: unknown[]) => unknown } = require('bull/lib/backoffs');
    const backoff = { type: 'exponential', delay: 30000 };
    expect(await backoffs.calculate(backoff, 1, {})).toBe(30000);
    expect(await backoffs.calculate(backoff, 2, {})).toBe(90000);
  });

  it('moveToFailed 재시도 조건에 discard 플래그가 들어 있다', () => {
    const src = fs.readFileSync(require.resolve('bull/lib/job.js'), 'utf8');
    expect(src).toContain('this.attemptsMade < this.opts.attempts && !this._discarded');
    expect(src).toContain('this._discarded = true;');
  });
});

describe('buildSynthesisFailedFields', () => {
  const GENERIC = { errorCode: SYNTHESIS_FAILED_CODE, errorMessage: SYNTHESIS_FAILED_MESSAGE };

  it('DomainError → 그 코드·메시지·상세', () => {
    const err = new DomainError(ErrorCodes.PDF_LOAD_FAILED, 'PDF 로드 실패 (암호화/손상/지원불가)', { input: 'cover' });
    expect(buildSynthesisFailedFields(err)).toEqual({
      errorCode: ErrorCodes.PDF_LOAD_FAILED,
      errorMessage: 'PDF 로드 실패 (암호화/손상/지원불가)',
      errorDetail: { input: 'cover' },
    });
  });

  it('DomainError 상세가 없으면 errorDetail 키가 없다', () => {
    const fields = buildSynthesisFailedFields(new DomainError(ErrorCodes.SESSION_NOT_FOUND, '세션 없음'));
    expect(fields).toEqual({ errorCode: ErrorCodes.SESSION_NOT_FOUND, errorMessage: '세션 없음' });
    expect(Object.prototype.hasOwnProperty.call(fields, 'errorDetail')).toBe(false);
  });

  it('상세는 허용 키의 원시값만 싣는다', () => {
    const err = new DomainError(ErrorCodes.FILE_DOWNLOAD_FAILED, '다운로드 실패', {
      url: 'https://files.example.com/a.pdf',
      cause: 'connect ECONNREFUSED 10.0.0.1:443',
      path: '/app/storage/uploads/a.pdf',
      stack: 'Error: x\n    at y',
      input: 'content',
      phase: 'download',
      httpStatus: 503,
      expected: 4,
      got: 3,
      index: 0,
      target: 'cover',
    });
    expect(buildSynthesisFailedFields(err).errorDetail).toEqual({
      input: 'content',
      phase: 'download',
      httpStatus: 503,
      expected: 4,
      got: 3,
      index: 0,
      target: 'cover',
    });
  });

  it('허용 키라도 객체·배열·유한수가 아닌 값은 싣지 않고, 남는 키가 없으면 errorDetail 이 없다', () => {
    const err = new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, '페이지 수 불일치', {
      expected: { cover: 1 },
      got: [1, 2],
      index: Number.NaN,
      cause: 'x',
    });
    expect(buildSynthesisFailedFields(err)).toEqual({
      errorCode: ErrorCodes.PAGE_COUNT_MISMATCH,
      errorMessage: '페이지 수 불일치',
    });
  });

  it.each([
    ['배열', ['input']],
    ['문자열', 'input=cover'],
  ])('%s 상세는 싣지 않는다', (_t, detail) => {
    const like = { name: 'DomainError', code: ErrorCodes.PDF_LOAD_FAILED, message: 'm', detail };
    expect(buildSynthesisFailedFields(like)).toEqual({ errorCode: ErrorCodes.PDF_LOAD_FAILED, errorMessage: 'm' });
  });

  it('코드 형식이 맞지 않는 DomainError 형태 → SYNTHESIS_FAILED·기본 문구', () => {
    const like = { name: 'DomainError', code: 'bad code/with path', message: 'raw /app/storage/x' };
    expect(buildSynthesisFailedFields(like)).toEqual(GENERIC);
  });

  it('DomainError 메시지가 비어 있으면 기본 문구', () => {
    expect(buildSynthesisFailedFields(new DomainError(ErrorCodes.INTERNAL_ERROR, ''))).toEqual({
      errorCode: ErrorCodes.INTERNAL_ERROR,
      errorMessage: SYNTHESIS_FAILED_MESSAGE,
    });
  });

  it.each([
    ['Error', new Error("qpdf assemble(2 parts → /app/storage/outputs/j/merged.pdf) 실패(code=2): Command failed")],
    ['ENOENT', Object.assign(new Error("ENOENT: no such file or directory, open '/app/storage/a.pdf'"), { code: 'ENOENT' })],
    ['응답 없는 axios 오류', Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' })],
    ['문자열', 'raw failure /app/storage'],
    ['undefined', undefined],
  ])('%s → SYNTHESIS_FAILED·기본 문구만', (_t, err) => {
    const fields = buildSynthesisFailedFields(err);
    expect(fields).toEqual(GENERIC);
    expect(JSON.stringify(fields)).not.toMatch(/app\/storage|ECONNREFUSED|qpdf/);
  });

  it('HTTP 응답 오류 → SYNTHESIS_FAILED·기본 문구·errorDetail { httpStatus }', () => {
    const err = Object.assign(new Error('Request failed with status code 404'), {
      code: 'ERR_BAD_REQUEST',
      response: { status: 404, data: 'not found' },
    });
    expect(buildSynthesisFailedFields(err)).toEqual({ ...GENERIC, errorDetail: { httpStatus: 404 } });
  });

  it('속성 읽기에서 예외가 나도 throw 하지 않는다', () => {
    const hostile = {
      get name(): string {
        throw new Error('getter');
      },
    };
    expect(buildSynthesisFailedFields(hostile)).toEqual(GENERIC);
  });
});
