// @vitest-environment happy-dom
// 템플릿셋 폼의 템플릿 목록 — 같은 템플릿을 여러 번 연결한 세트에서 행이 따로 다뤄지는지.
import { createTestQueryClient, renderWithAntd, stubAntdFeedback } from '../../test/renderWithAntd';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EditorMode, TemplateSetType, TemplateType } from '@storige/types';
import { TemplateSetForm } from './TemplateSetForm';

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getAllSets: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  getAllTemplates: vi.fn(),
  getTemplateById: vi.fn(),
  getCategories: vi.fn(),
  listPresets: vi.fn(),
}));

vi.mock('../../api/template-sets', () => ({
  templateSetsApi: { getById: mocks.getById, getAll: mocks.getAllSets, update: mocks.update, create: mocks.create },
}));
vi.mock('../../api/templates', () => ({
  templatesApi: { getAll: mocks.getAllTemplates, getById: mocks.getTemplateById },
}));
vi.mock('../../api/library', () => ({ libraryApi: { getCategories: mocks.getCategories } }));
vi.mock('../../api/formatPresets', () => ({ formatPresetsApi: { list: mocks.listPresets } }));
vi.mock('../../lib/axios', () => ({
  axiosInstance: {},
  resolveStorageUrl: (url: string | undefined) => url ?? '',
}));
vi.mock('./OrientationPairSection', () => ({ OrientationPairSection: () => null }));

const WIDTH = 210;
const HEIGHT = 297;

function template(id: string) {
  return {
    id,
    name: `템플릿 ${id}`,
    type: TemplateType.PAGE,
    width: WIDTH,
    height: HEIGHT,
    thumbnailUrl: null,
    canvasData: { objects: [] },
    isActive: true,
    isDeleted: false,
  };
}

// t1 을 세 번 연결한 세트
const REFS = [
  { templateId: 't1', required: false },
  { templateId: 't2', required: false },
  { templateId: 't1', required: false },
  { templateId: 't1', required: false },
];

const SET = {
  id: 'ts-1',
  name: '반복 세트',
  type: TemplateSetType.LEAFLET,
  editorMode: EditorMode.SINGLE,
  width: WIDTH,
  height: HEIGHT,
  siteId: null,
  thumbnailUrl: null,
  canAddPage: false,
  pageCountRange: [4, 4],
  pageStep: null,
  padToPageStep: false,
  templates: REFS,
  enabledMenus: null,
  endpaperConfig: null,
  coverEditable: true,
  coverPreviewImage: null,
  contentPdfEditable: true,
  pdfOutputMode: 'duplex-merged',
  colorMode: 'rgb',
  libraryCategoryIds: [],
  coverType: null,
  coverConfig: null,
  pricing: null,
  bleedMm: 3,
  cropMarkEnabled: true,
  sizeToleranceMm: 0.2,
  isDeleted: false,
  productProfile: null,
};

function renderForm() {
  return renderWithAntd(
    <MemoryRouter initialEntries={['/template-sets/ts-1']}>
      <Routes>
        <Route path="/template-sets/:id" element={<TemplateSetForm />} />
        <Route path="/template-sets" element={<div>목록</div>} />
      </Routes>
    </MemoryRouter>,
    { queryClient: createTestQueryClient() },
  );
}

async function loadedRows(): Promise<HTMLElement[]> {
  await waitFor(() => expect(screen.queryAllByTestId('template-row')).toHaveLength(REFS.length));
  return screen.getAllByTestId('template-row');
}

const rowNames = (): string[] =>
  screen.getAllByTestId('template-row').map((row) => (within(row).queryByText('템플릿 t1') ? 't1' : 't2'));

async function savedTemplates(): Promise<unknown> {
  fireEvent.click(screen.getByText('수정').closest('button') as HTMLButtonElement);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
  return (mocks.update.mock.calls[0] as [string, { templates: unknown }])[1].templates;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getById.mockResolvedValue(SET);
  mocks.getAllSets.mockResolvedValue([SET]);
  mocks.getAllTemplates.mockResolvedValue([template('t1'), template('t2')]);
  mocks.update.mockResolvedValue({});
  mocks.getCategories.mockResolvedValue([]);
  mocks.listPresets.mockResolvedValue([]);
  stubAntdFeedback();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('같은 템플릿을 여러 번 연결한 세트', () => {
  it('행을 모두 그리고, 같은 key 경고를 내지 않는다', async () => {
    renderForm();
    await loadedRows();
    expect(rowNames()).toEqual(['t1', 't2', 't1', 't1']);
    const duplicateKeyWarnings = consoleError.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('same key')),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it('한 행을 지우면 그 행만 빠지고, 저장 내용에도 그대로 반영된다', async () => {
    renderForm();
    const rows = await loadedRows();
    fireEvent.click(rows[2].querySelector('button.ant-btn-dangerous') as HTMLButtonElement);
    await waitFor(() => expect(screen.getAllByTestId('template-row')).toHaveLength(3));
    expect(rowNames()).toEqual(['t1', 't2', 't1']);
    expect(await savedTemplates()).toEqual([
      { templateId: 't1', required: false },
      { templateId: 't2', required: false },
      { templateId: 't1', required: false },
    ]);
  });

  it('한 행의 필수 여부를 바꾸면 그 행만 바뀐다', async () => {
    renderForm();
    const rows = await loadedRows();
    fireEvent.click(within(rows[3]).getByText('필수 설정').closest('button') as HTMLButtonElement);
    await waitFor(() => expect(screen.getAllByText('필수 해제')).toHaveLength(1));
    expect(await savedTemplates()).toEqual([
      { templateId: 't1', required: false },
      { templateId: 't2', required: false },
      { templateId: 't1', required: false },
      { templateId: 't1', required: true },
    ]);
  });

  it('열고 그대로 저장하면 연결 목록이 그대로다', async () => {
    renderForm();
    await loadedRows();
    expect(await savedTemplates()).toEqual(REFS);
  });
});
