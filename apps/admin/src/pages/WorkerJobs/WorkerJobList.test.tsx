// @vitest-environment happy-dom
// 워커 작업 상세 — VALIDATE 잡은 원본 JSON 위에 구조화된 검증 결과 카드를 함께 보이고, 그 밖의 잡은 원본 JSON 만 보인다.
import { buttonByText, createTestQueryClient, openDialog, renderWithAntd } from '../../test/renderWithAntd';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerJobStatus, WorkerJobType, type WorkerJob } from '@storige/types';
import { WorkerJobList } from './WorkerJobList';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getStats: vi.fn(),
  listSites: vi.fn(),
}));

vi.mock('../../api/worker-jobs', () => ({
  workerJobsApi: { getAll: mocks.getAll, getStats: mocks.getStats },
}));

vi.mock('../../api/sites', () => ({ sitesApi: { list: mocks.listSites } }));

vi.mock('../../lib/axios', () => ({ resolveStorageUrl: (url: string) => url }));

vi.mock('../../stores/authStore', () => {
  const state = { currentSiteId: 'site-1' };
  return { useAuthStore: <T,>(selector: (s: typeof state) => T): T => selector(state) };
});

/** API 가 돌려주는 런타임 실물(검증 결과는 { result: {...} } 로 감싼 형태)을 그대로 담은 잡 */
function job(id: string, jobType: WorkerJobType, status: WorkerJobStatus, result: unknown): WorkerJob {
  return {
    id,
    jobType,
    status,
    inputFileUrl: 'storage/test/input.pdf',
    result: result as WorkerJob['result'],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    completedAt: new Date('2026-10-01T00:01:00.000Z'),
    siteId: 'site-1',
  };
}

const validateJob = job('job-validate-0001', WorkerJobType.VALIDATE, WorkerJobStatus.COMPLETED, {
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

const synthesizeJob = job('job-synth-0001', WorkerJobType.SYNTHESIZE, WorkerJobStatus.COMPLETED, {
  outputFileUrl: 'storage/outputs/merged.pdf',
  pageCount: 10,
});

const unknownValidateJob = job('job-validate-0002', WorkerJobType.VALIDATE, WorkerJobStatus.COMPLETED, {
  outputFileUrl: 'storage/outputs/x.pdf',
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getAll.mockResolvedValue([validateJob, synthesizeJob, unknownValidateJob]);
  mocks.getStats.mockResolvedValue([]);
  mocks.listSites.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openDetail(jobId: string): Promise<HTMLElement> {
  renderWithAntd(<WorkerJobList />, { queryClient: createTestQueryClient() });
  const row = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(`tr[data-row-key="${jobId}"]`);
    if (!el) throw new Error(`행 ${jobId} 가 없습니다`);
    return el;
  });
  fireEvent.click(buttonByText(row, '상세'));
  const dialog = openDialog();
  if (!dialog) throw new Error('작업 상세 창이 없습니다');
  return dialog;
}

describe('WorkerJobList 작업 상세', () => {
  it('VALIDATE 잡은 검증 결과 카드와 원본 JSON 카드를 함께 보인다', async () => {
    const dialog = await openDetail(validateJob.id);
    const scope = within(dialog);

    expect(scope.getByText('검증 결과')).toBeTruthy();
    expect(scope.getByText('재단 크기(TrimBox) 기준 판형')).toBeTruthy();
    expect(scope.getByText('재단 크기(TrimBox)')).toBeTruthy();
    expect(scope.getByText('에러: 0개, 경고: 1개 (정보 1개 포함)')).toBeTruthy();
    expect(scope.getByText('처리 결과')).toBeTruthy();
  });

  it('VALIDATE 가 아닌 잡은 원본 JSON 카드만 보인다', async () => {
    const dialog = await openDetail(synthesizeJob.id);
    const scope = within(dialog);

    expect(scope.queryByText('검증 결과')).toBeNull();
    expect(scope.getByText('처리 결과')).toBeTruthy();
  });

  it('결과 형식을 알 수 없는 VALIDATE 잡은 원본 JSON 카드만 보인다', async () => {
    const dialog = await openDetail(unknownValidateJob.id);
    const scope = within(dialog);

    expect(scope.queryByText('검증 결과')).toBeNull();
    expect(scope.getByText('처리 결과')).toBeTruthy();
  });
});
