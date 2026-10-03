// @vitest-environment happy-dom
// 세션 작업 목록 — 결과가 남는 VALIDATE 행은 '검증 결과' 를 펼칠 때만 잡을 조회해 보이고,
// 조회 실패·형식을 알 수 없는 결과는 아무것도 보이지 않는다.
import { buttonByText, createTestQueryClient, deferred, renderWithAntd } from '../../test/renderWithAntd';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerJobStatus, WorkerJobType, type WorkerJob } from '@storige/types';
import type { StaffJobItem } from '../../api/edit-data';
import { makeSessionItem } from '../../test/sessionFixtures';
import { SessionJobsDrawer } from './SessionJobsDrawer';

const mocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listGrants: vi.fn(),
  revokeGrant: vi.fn(),
  downloadJobOutput: vi.fn(),
  saveDownloadedFile: vi.fn(),
  getById: vi.fn(),
}));

vi.mock('../../api/edit-data', () => ({
  editDataApi: {
    listJobs: mocks.listJobs,
    listGrants: mocks.listGrants,
    revokeGrant: mocks.revokeGrant,
    downloadJobOutput: mocks.downloadJobOutput,
  },
  saveDownloadedFile: mocks.saveDownloadedFile,
}));

vi.mock('../../api/worker-jobs', () => ({ workerJobsApi: { getById: mocks.getById } }));

function jobItem(id: string, jobType: string, status: string): StaffJobItem {
  return {
    id,
    jobType,
    status,
    capability: null,
    staffInitiated: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    completedAt: status === 'PROCESSING' ? null : '2026-10-01T00:01:00.000Z',
    hasOutput: false,
  };
}

const validateDone = jobItem('job-validate-done', 'VALIDATE', 'COMPLETED');
const validateRunning = jobItem('job-validate-running', 'VALIDATE', 'PROCESSING');
const synthesizeDone = jobItem('job-synth-done', 'SYNTHESIZE', 'COMPLETED');

/** GET /worker-jobs/:id 의 런타임 실물(검증 결과는 { result: {...} } 로 감싼 형태) */
function workerJob(result: unknown): WorkerJob {
  return {
    id: validateDone.id,
    jobType: WorkerJobType.VALIDATE,
    status: WorkerJobStatus.COMPLETED,
    result: result as WorkerJob['result'],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}

const validationJob = workerJob({
  result: {
    isValid: true,
    errors: [],
    warnings: [
      {
        code: 'TRIMBOX_SIZE_BASIS',
        message: '재단 크기(TrimBox) 기준으로 판형을 확인했습니다.',
        details: { sizeBasis: 'trimBox', trimBox: { width: 210, height: 297 }, mediaBox: { width: 236, height: 323 } },
        autoFixable: false,
      },
    ],
    metadata: { pageCount: 4, pageSize: { width: 236, height: 323 }, trimBox: { width: 210, height: 297 } },
  },
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listJobs.mockResolvedValue([validateDone, validateRunning, synthesizeDone]);
  mocks.listGrants.mockResolvedValue([]);
  mocks.getById.mockResolvedValue(validationJob);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderDrawer(): Promise<void> {
  renderWithAntd(<SessionJobsDrawer session={makeSessionItem()} open onClose={vi.fn()} />, {
    queryClient: createTestQueryClient(),
  });
  await waitFor(() => row(validateDone.id));
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`tr[data-row-key="${id}"]`);
  if (!el) throw new Error(`행 ${id} 가 없습니다`);
  return el;
}

/** 펼친 행 바로 아래의 펼침 내용 행 */
function expandedRow(id: string): HTMLElement {
  const next = row(id).nextElementSibling;
  if (!(next instanceof HTMLElement) || !next.classList.contains('ant-table-expanded-row')) {
    throw new Error(`행 ${id} 의 펼침 내용이 없습니다`);
  }
  return next;
}

async function expandAndSettle(id: string): Promise<HTMLElement> {
  fireEvent.click(buttonByText(row(id), '검증 결과'));
  await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(expandedRow(id).querySelector('.ant-spin')).toBeNull());
  return expandedRow(id);
}

describe('SessionJobsDrawer 검증 결과 펼침', () => {
  it('결과가 남는 VALIDATE 행에만 검증 결과 펼침이 있고, 펼치기 전에는 잡을 조회하지 않는다', async () => {
    await renderDrawer();

    expect(within(row(validateDone.id)).getByText('검증 결과')).toBeTruthy();
    expect(within(row(validateRunning.id)).queryByText('검증 결과')).toBeNull();
    expect(within(row(synthesizeDone.id)).queryByText('검증 결과')).toBeNull();
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it('펼치면 그 잡을 1회 조회해 TrimBox 정보성 라벨과 재단 크기 행을 보인다', async () => {
    await renderDrawer();

    const content = await expandAndSettle(validateDone.id);

    expect(mocks.getById).toHaveBeenCalledWith(validateDone.id);
    const scope = within(content);
    expect(scope.getByText('재단 크기(TrimBox) 기준 판형')).toBeTruthy();
    expect(scope.getByText('재단 크기(TrimBox)')).toBeTruthy();
    expect(scope.getByText('에러: 0개, 경고: 1개 (정보 1개 포함)')).toBeTruthy();
    expect(within(row(validateDone.id)).getByText('검증 결과 접기')).toBeTruthy();
  });

  it('조회 중에는 로딩 표시를, 끝나면 검증 결과를 보인다', async () => {
    const pending = deferred<WorkerJob>();
    mocks.getById.mockReturnValue(pending.promise);
    await renderDrawer();

    fireEvent.click(buttonByText(row(validateDone.id), '검증 결과'));
    await waitFor(() => expect(expandedRow(validateDone.id).querySelector('.ant-spin')).not.toBeNull());

    await act(async () => {
      pending.resolve(validationJob);
      await pending.promise;
    });
    await waitFor(() => expect(within(expandedRow(validateDone.id)).getByText('검증 통과')).toBeTruthy());
  });

  it('조회에 실패하면 검증 결과를 보이지 않고 작업 목록은 그대로 둔다', async () => {
    mocks.getById.mockRejectedValue(new Error('x'));
    await renderDrawer();

    const content = await expandAndSettle(validateDone.id);

    expect(content.textContent).toBe('');
    expect(document.body.querySelector('.ant-alert')).toBeNull();
    expect(row(synthesizeDone.id)).toBeTruthy();
  });

  it('결과 형식을 알 수 없으면 검증 결과를 보이지 않는다', async () => {
    mocks.getById.mockResolvedValue(workerJob({ outputFileUrl: 'storage/outputs/x.pdf' }));
    await renderDrawer();

    const content = await expandAndSettle(validateDone.id);

    expect(content.textContent).toBe('');
  });
});
