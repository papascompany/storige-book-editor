/**
 * C+ G2 (2026-07-11): isFixableEquivalentFailure 술어 잠금.
 *
 * 워커 게이팅(WORKER_WIRED_FIXABLE_GATING) ON 시 실행기 없는 fixMethod(SIZE/SPINE)
 * 에러 잡이 FIXABLE→FAILED 로 내려오지만, 세션(생성 PDF) 경로의 종전 의미
 * (자동수정급 이슈 = VALIDATED 로 주문 진행)는 보존해야 한다. 이 술어가
 * '게이팅 전 FIXABLE 이었을 FAILED'(= 모든 에러가 fixMethod 보유)를 판정한다.
 *
 * 술어는 updateDto 만 읽는 순수 함수(this 미사용) → DI 없이 prototype 직접 호출로 잠근다.
 * ⚠️ 게이팅 OFF(현행)에서는 'FAILED + 전원 fixMethod' 조합이 워커에서 생성되지 않으므로
 *    (autoFixable=true 면 processor 가 FIXABLE 로 판정) 이 술어는 실질 no-op — byte-identical.
 */
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobStatus } from '@storige/types';

const call = (dto: unknown): boolean =>
  (
    WorkerJobsService.prototype as unknown as {
      isFixableEquivalentFailure: (d: unknown) => boolean;
    }
  ).isFixableEquivalentFailure.call(null, dto);

const sizeErr = {
  code: 'SIZE_MISMATCH',
  message: '페이지 크기가 맞지 않습니다.',
  details: {},
  autoFixable: false,
  fixMethod: 'resizeWithPadding',
};
const pageErr = {
  code: 'PAGE_COUNT_INVALID',
  message: '4의 배수여야 합니다.',
  details: {},
  autoFixable: true,
  fixMethod: 'addBlankPages',
};
const corruptedErr = {
  code: 'FILE_CORRUPTED',
  message: '파일이 손상되었습니다.',
  details: {},
  autoFixable: false,
};

describe('WorkerJobsService.isFixableEquivalentFailure (C+ G2)', () => {
  it('FAILED + 모든 에러 fixMethod 보유(이중 중첩 result.result) → true', () => {
    expect(
      call({
        status: WorkerJobStatus.FAILED,
        result: { result: { isValid: false, errors: [sizeErr], warnings: [], metadata: {} } },
      }),
    ).toBe(true);
  });

  it('FAILED + 혼재 에러(SIZE+PAGE_COUNT, 둘 다 fixMethod) → true (종전 FIXABLE 급)', () => {
    expect(
      call({
        status: WorkerJobStatus.FAILED,
        result: { result: { errors: [sizeErr, pageErr] } },
      }),
    ).toBe(true);
  });

  it('단일 중첩(result.errors) 방어 지원 → true', () => {
    expect(
      call({ status: WorkerJobStatus.FAILED, result: { errors: [sizeErr] } }),
    ).toBe(true);
  });

  it('FAILED + fixMethod 없는 에러 포함(FILE_CORRUPTED 혼재) → false (기존 FAILED 처리)', () => {
    expect(
      call({
        status: WorkerJobStatus.FAILED,
        result: { result: { errors: [sizeErr, corruptedErr] } },
      }),
    ).toBe(false);
  });

  it('FAILED + FILE_CORRUPTED 단독(예외/손상 경로) → false', () => {
    expect(
      call({
        status: WorkerJobStatus.FAILED,
        result: { result: { errors: [corruptedErr] } },
      }),
    ).toBe(false);
  });

  it('FAILED + errors 빈 배열/부재/result 부재 → false', () => {
    expect(call({ status: WorkerJobStatus.FAILED, result: { result: { errors: [] } } })).toBe(false);
    expect(call({ status: WorkerJobStatus.FAILED, result: {} })).toBe(false);
    expect(call({ status: WorkerJobStatus.FAILED })).toBe(false);
  });

  it('FAILED 아닌 status(FIXABLE/COMPLETED) → false (status 가드)', () => {
    expect(
      call({ status: WorkerJobStatus.FIXABLE, result: { result: { errors: [pageErr] } } }),
    ).toBe(false);
    expect(
      call({ status: WorkerJobStatus.COMPLETED, result: { result: { errors: [] } } }),
    ).toBe(false);
  });
});
