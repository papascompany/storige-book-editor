// @vitest-environment happy-dom
// 템플릿셋 규격 카드 — 미리보기 수치(resolvePrintGeometry 결과), 도련 토글 저장 매핑, 기존 세트 저장값 유지.
import { createTestQueryClient, renderWithAntd, stubAntdFeedback } from '../../test/renderWithAntd';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  EditorMode,
  TemplateSetType,
  TemplateType,
  resolvePrintGeometry,
  type ProductProfile,
  type Template,
} from '@storige/types';
import {
  bleedFieldsForToggle,
  buildCompositionSummary,
  buildPrintGeometryPreview,
  findCoverTemplate,
  formatMmSize,
  isBleedOutOfInputRange,
  bleedInputError,
  toleranceInputError,
  BLEED_INPUT_ERROR,
  TOLERANCE_INPUT_ERROR,
} from './printGeometryPreview';
import { CALENDAR_PROFILE_PRESETS } from './calendarProfilePresets';
import { TemplateSetForm } from './TemplateSetForm';

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  getAllTemplates: vi.fn(),
  getTemplateById: vi.fn(),
  getCategories: vi.fn(),
  listPresets: vi.fn(),
}));

vi.mock('../../api/template-sets', () => ({
  templateSetsApi: { getById: mocks.getById, update: mocks.update, create: mocks.create },
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

// ─── 순수 헬퍼 ─────────────────────────────────────────────────────────────

describe('buildPrintGeometryPreview — 수치는 resolvePrintGeometry 결과 그대로', () => {
  const cases: Array<[boolean, number]> = [
    [true, 0],
    [true, 1],
    [true, 3],
    [true, 5],
    [false, 0],
    [false, 1],
    [false, 3],
    [false, 5],
  ];

  it.each(cases)('재단선 %s · 도련 %smm', (cropMarkEnabled, bleedMm) => {
    const source = { width: 210, height: 150, bleedMm, cropMarkEnabled };
    const expected = resolvePrintGeometry(source);
    const preview = buildPrintGeometryPreview({ ...source, sizeToleranceMm: 0.2 }, null, false);
    expect(preview).not.toBeNull();
    expect(preview?.geometry).toEqual(expected);
    expect(preview?.pdfPageMm).toEqual(expected.workMm);
    expect(preview?.pdfTrimBoxMm).toEqual(expected.cropMarks ? expected.trimMm : null);
    expect(preview?.validationSizesMm).toEqual(
      expected.cropMarks ? [expected.trimMm, expected.workMm] : [expected.trimMm],
    );
    expect(preview?.storedBleedMm).toBe(bleedMm);
    expect(preview?.storedBleedKept).toBe(!cropMarkEnabled && bleedMm > 0);
    expect(preview?.validationToleranceMm).toBe(cropMarkEnabled ? 0.2 : 1);
  });

  it('재단선 on · 도련 1mm 세트는 작업 212 × 152, 재단선 off 세트는 저장 도련과 무관하게 작업 = 재단', () => {
    const on = buildPrintGeometryPreview({ width: 210, height: 150, bleedMm: 1, cropMarkEnabled: true }, null, false);
    expect(on && formatMmSize(on.geometry.workMm)).toBe('212 × 152 mm');
    const off = buildPrintGeometryPreview({ width: 210, height: 150, bleedMm: 3, cropMarkEnabled: false }, null, false);
    expect(off && formatMmSize(off.geometry.workMm)).toBe('210 × 150 mm');
    expect(off?.geometry.bleedMm).toBe(0);
  });

  it('재단 W/H 가 없으면 null', () => {
    expect(buildPrintGeometryPreview({ width: undefined, height: 150 }, null, false)).toBeNull();
    expect(buildPrintGeometryPreview({ width: 0, height: 150 }, null, false)).toBeNull();
  });
});

function coverSpread(cutSizeMm: number, conversionMode?: 'flat-spread'): Template {
  return {
    id: 'tpl-cover',
    name: '표지',
    type: TemplateType.SPREAD,
    width: 430,
    height: 150,
    spreadConfig: {
      version: 1,
      spec: {
        coverWidthMm: 210,
        coverHeightMm: 150,
        spineWidthMm: 10,
        wingEnabled: false,
        wingWidthMm: 0,
        cutSizeMm,
        safeSizeMm: 3,
        dpi: 150,
      },
      regions: [],
      totalWidthMm: 430,
      totalHeightMm: 150,
      ...(conversionMode ? { conversionMode } : {}),
    },
  } as unknown as Template;
}

function innerPage(): Template {
  return { id: 'tpl-page', name: '내지', type: TemplateType.PAGE, width: 210, height: 150 } as unknown as Template;
}

describe('표지 펼침면 cutSizeMm (양변 합 · 변당 표기)', () => {
  it('도련 있음 — 세트 도련 × 2 가 템플릿 저장값보다 우선', () => {
    const p = buildPrintGeometryPreview({ width: 210, height: 150, bleedMm: 1, cropMarkEnabled: true }, coverSpread(3), true);
    expect(p?.coverCutSize).toEqual({ totalMm: 2, perEdgeMm: 1, source: 'set' });
    expect(p?.coverCutSize?.totalMm).toBe(resolvePrintGeometry({ width: 210, height: 150, bleedMm: 1, cropMarkEnabled: true }).coverSpreadCutSizeMm);
  });

  it('도련 없음 — 표지 템플릿 저장값 우선, 없으면 함수 기본값', () => {
    const withStored = buildPrintGeometryPreview({ width: 210, height: 150, bleedMm: 3, cropMarkEnabled: false }, coverSpread(3), true);
    expect(withStored?.coverCutSize).toEqual({ totalMm: 3, perEdgeMm: 1.5, source: 'template' });
    const noStored = buildPrintGeometryPreview({ width: 210, height: 150, bleedMm: 3, cropMarkEnabled: false }, coverSpread(0), true);
    expect(noStored?.coverCutSize).toEqual({ totalMm: 2, perEdgeMm: 1, source: 'default' });
  });

  it('책모드인데 표지 템플릿을 모르면 기본값 + 템플릿 값 우선 안내, 책모드도 표지도 아니면 표시 없음', () => {
    const unknown = buildPrintGeometryPreview({ width: 210, height: 150, bleedMm: 3, cropMarkEnabled: false }, null, true);
    expect(unknown?.coverCutSize).toEqual({ totalMm: 2, perEdgeMm: 1, source: 'unknown' });
    const none = buildPrintGeometryPreview({ width: 210, height: 150, bleedMm: 3, cropMarkEnabled: false }, null, false);
    expect(none?.coverCutSize).toBeNull();
  });

  it('기본 표지는 편집기와 같은 규칙(첫 표지류 템플릿)', () => {
    const cover = coverSpread(3);
    expect(findCoverTemplate([innerPage(), undefined, cover])).toBe(cover);
    expect(findCoverTemplate([innerPage()])).toBeNull();
  });
});

describe('bleedFieldsForToggle — 토글을 바꿀 때만 쓰는 저장 매핑', () => {
  it('없음 = 재단선 false + 도련 0', () => {
    expect(bleedFieldsForToggle(false, 3)).toEqual({ cropMarkEnabled: false, bleedMm: 0 });
  });

  it('있음 = 재단선 true + 현재 값(> 0), 0 이면 기억해 둔 값, 그것도 없으면 3', () => {
    expect(bleedFieldsForToggle(true, 1)).toEqual({ cropMarkEnabled: true, bleedMm: 1 });
    expect(bleedFieldsForToggle(true, 0, 1.5)).toEqual({ cropMarkEnabled: true, bleedMm: 1.5 });
    expect(bleedFieldsForToggle(true, 0)).toEqual({ cropMarkEnabled: true, bleedMm: 3 });
    expect(bleedFieldsForToggle(true, undefined, undefined)).toEqual({ cropMarkEnabled: true, bleedMm: 3 });
  });

  it('입력 범위 밖 판정 — 0.5 단위·0~5', () => {
    expect(isBleedOutOfInputRange(2.5)).toBe(false);
    expect(isBleedOutOfInputRange(0)).toBe(false);
    expect(isBleedOutOfInputRange(5)).toBe(false);
    expect(isBleedOutOfInputRange(1.2)).toBe(true);
    expect(isBleedOutOfInputRange(10)).toBe(true);
    expect(isBleedOutOfInputRange(undefined)).toBe(false);
  });
});

describe('저장 전 범위 검사 — 불러온 값은 통과, 새 값만 검사', () => {
  it('사방 도련', () => {
    expect(bleedInputError(8, 8)).toBeNull();
    expect(bleedInputError(1.125, 1.125)).toBeNull();
    expect(bleedInputError(8, 3)).toBe(BLEED_INPUT_ERROR);
    expect(bleedInputError(1.2, 3)).toBe(BLEED_INPUT_ERROR);
    expect(bleedInputError(-0.5, 3)).toBe(BLEED_INPUT_ERROR);
    expect(bleedInputError(1.5, 3)).toBeNull();
    expect(bleedInputError(5, undefined)).toBeNull();
    expect(bleedInputError(null, 3)).toBeNull();
  });

  it('업로드 허용오차', () => {
    expect(toleranceInputError(7, 7)).toBeNull();
    expect(toleranceInputError(7, 0.2)).toBe(TOLERANCE_INPUT_ERROR);
    expect(toleranceInputError(-0.1, 0.2)).toBe(TOLERANCE_INPUT_ERROR);
    expect(toleranceInputError(0.125, 0.2)).toBeNull();
    expect(toleranceInputError(undefined, 0.2)).toBeNull();
  });
});

describe('buildCompositionSummary — 표시만', () => {
  it('캘린더 프로파일 세트는 표지/월/에필로그 수와 읽기 전용 페이지 규칙', () => {
    const profile = CALENDAR_PROFILE_PRESETS[0].profile as ProductProfile;
    const cal = profile.calendar;
    const summary = buildCompositionSummary({ productProfile: profile, templates: [] });
    expect(summary.source).toBe('profile');
    expect(summary.items).toContainEqual({ label: '표지', value: `${cal?.coverCanvases}` });
    expect(summary.items).toContainEqual({ label: '에필로그', value: `${cal?.epilogueCanvases}` });
    expect(summary.pageRule).toBe(`상품 프로파일에서 관리 (${profile.pages.count}쪽 고정)`);
  });

  it('책자는 표지 방식·책등·면지·내지와 페이지 범위', () => {
    const split = buildCompositionSummary({
      productProfile: null,
      templates: [coverSpread(3), innerPage()],
      useEndpaper: true,
      endpaperFrontCount: 2,
      endpaperBackCount: 1,
      canAddPage: true,
      pageCountMin: 10,
      pageCountMax: 100,
      pageStep: 2,
    });
    expect(split.items).toEqual([
      { label: '표지', value: '표지3분할' },
      { label: '책등', value: '자동 (내지 수에 따라)' },
      { label: '면지', value: '앞 2 · 뒤 1' },
      { label: '내지', value: '내지낱장 1장' },
    ]);
    expect(split.pageRule).toBe('10~100쪽, 증감 2');

    const fixed = buildCompositionSummary({ productProfile: null, templates: [coverSpread(3, 'flat-spread')], canAddPage: false });
    expect(fixed.items[1]).toEqual({ label: '책등', value: '고정 10mm' });
    expect(fixed.pageRule).toBe('내지 추가 불가');
  });
});

// ─── 폼 렌더 — 기존 세트를 열고 그대로 저장 / 토글 변경 ───────────────────────────

interface SetFixture {
  cropMarkEnabled: boolean;
  bleedMm: number;
  sizeToleranceMm: number;
  width?: number;
}

function templateSetFixture(spec: SetFixture, overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts-1',
    name: '기존 세트',
    type: TemplateSetType.LEAFLET,
    editorMode: EditorMode.SINGLE,
    width: 210,
    height: 150,
    canAddPage: true,
    pageCountRange: [10, 100],
    pageStep: null,
    padToPageStep: false,
    templates: [],
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
    productProfile: null,
    ...spec,
    ...overrides,
  };
}

function renderForm(path = '/template-sets/ts-1') {
  return renderWithAntd(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/template-sets/new" element={<TemplateSetForm />} />
        <Route path="/template-sets/:id" element={<TemplateSetForm />} />
        <Route path="/template-sets" element={<div>목록</div>} />
      </Routes>
    </MemoryRouter>,
    { queryClient: createTestQueryClient() },
  );
}

async function specCard(trimText = '210 × 150 mm'): Promise<HTMLElement> {
  const card = await screen.findByTestId('spec-card');
  await waitFor(() => expect(within(card).getByTestId('spec-trim').textContent).toBe(trimText));
  return card;
}

/** 규격 카드 숫자 칸(재단 너비·높이·사방 도련·허용오차) */
function specNumberInputs(card: HTMLElement): HTMLInputElement[] {
  const inputs = within(card).getAllByRole('spinbutton') as HTMLInputElement[];
  expect(inputs).toHaveLength(4);
  return inputs;
}

/** 칸에 들어갔다 나오기 — React onBlur 는 focusout 으로 받는다 */
function focusAndBlur(input: HTMLInputElement): void {
  fireEvent.focusIn(input);
  fireEvent.focus(input);
  fireEvent.focusOut(input);
  fireEvent.blur(input);
}

async function submitAndCapture(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByText('수정').closest('button') as HTMLButtonElement);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
  const [id, data] = mocks.update.mock.calls[0] as [string, Record<string, unknown>];
  expect(id).toBe('ts-1');
  return data;
}

/** 「수정」 클릭 후 마지막 저장 payload — 키 입력이 먼저 제출을 일으켰어도 마지막 호출을 본다 */
async function submitLatest(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByText('수정').closest('button') as HTMLButtonElement);
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  const calls = mocks.update.mock.calls as Array<[string, Record<string, unknown>]>;
  for (const [, data] of calls) expect(data).toEqual(calls[calls.length - 1][1]);
  return calls[calls.length - 1][1];
}

/** 도련 라디오 선택 — happy-dom 은 label 클릭을 input 으로 넘기지 않아 input 을 직접 누른다 */
function chooseBleed(card: HTMLElement, label: string): void {
  const input = within(card).getByText(label).closest('label')?.querySelector('input');
  if (!input) throw new Error(`도련 라디오 '${label}' 가 없습니다`);
  fireEvent.click(input);
}

function pickSpec(data: Record<string, unknown>) {
  return {
    width: data.width,
    height: data.height,
    bleedMm: data.bleedMm,
    cropMarkEnabled: data.cropMarkEnabled,
    sizeToleranceMm: data.sizeToleranceMm,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.update.mockResolvedValue({});
  mocks.getAllTemplates.mockResolvedValue([]);
  mocks.getCategories.mockResolvedValue([]);
  mocks.listPresets.mockResolvedValue([]);
  stubAntdFeedback();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TemplateSetForm 규격 카드 — 기존 세트를 열고 그대로 저장하면 규격 값이 바뀌지 않는다', () => {
  const fixtures: Array<[string, SetFixture]> = [
    ['재단선 off · 도련 3', { cropMarkEnabled: false, bleedMm: 3, sizeToleranceMm: 0.2 }],
    ['재단선 on · 도련 3', { cropMarkEnabled: true, bleedMm: 3, sizeToleranceMm: 0.2 }],
    ['재단선 on · 도련 1', { cropMarkEnabled: true, bleedMm: 1, sizeToleranceMm: 0.5 }],
    ['재단선 on · 도련 8(입력 범위 밖) · 허용오차 0.2', { cropMarkEnabled: true, bleedMm: 8, sizeToleranceMm: 0.2 }],
    [
      '재단선 on · 도련 1.125 · 허용오차 0.125 · 너비 210.125',
      { cropMarkEnabled: true, bleedMm: 1.125, sizeToleranceMm: 0.125, width: 210.125 },
    ],
    ['재단선 on · 도련 0 · 허용오차 0.2', { cropMarkEnabled: true, bleedMm: 0, sizeToleranceMm: 0.2 }],
    ['재단선 off · 도련 8 · 허용오차 7(입력 범위 밖)', { cropMarkEnabled: false, bleedMm: 8, sizeToleranceMm: 7 }],
  ];

  it.each(fixtures)('%s — 각 칸 focus/blur 후 저장', async (_name, spec) => {
    const loaded = { width: 210, height: 150, ...spec };
    mocks.getById.mockResolvedValue(templateSetFixture(spec, { width: loaded.width }));
    renderForm();
    const card = await specCard(formatMmSize({ w: loaded.width, h: 150 }));

    const expected = resolvePrintGeometry(loaded);
    expect(within(card).getByTestId('spec-work').textContent).toBe(formatMmSize(expected.workMm));
    if (!spec.cropMarkEnabled && spec.bleedMm > 0) {
      expect(within(card).getByText(`도련 없음으로 출력됩니다. 저장된 도련 값 ${spec.bleedMm}mm 는 그대로 유지됩니다.`)).toBeTruthy();
    }

    for (const input of specNumberInputs(card)) focusAndBlur(input);

    const data = await submitAndCapture();
    expect(pickSpec(data)).toEqual(loaded);
  });

  it('범위 밖 도련(8) 칸에서 Enter — 클램프 없이 불러온 값 그대로 제출', async () => {
    const spec: SetFixture = { cropMarkEnabled: true, bleedMm: 8, sizeToleranceMm: 0.2 };
    mocks.getById.mockResolvedValue(templateSetFixture(spec));
    renderForm();
    const card = await specCard();
    const [, , bleedInput, toleranceInput] = specNumberInputs(card);
    expect(Number(bleedInput.value)).toBe(8);

    fireEvent.focusIn(bleedInput);
    fireEvent.keyDown(bleedInput, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(bleedInput, { key: 'Enter', code: 'Enter' });
    fireEvent.focusOut(bleedInput);
    expect(Number(bleedInput.value)).toBe(8);
    fireEvent.keyDown(toleranceInput, { key: 'Enter', code: 'Enter' });

    const data = await submitLatest();
    expect(pickSpec(data)).toEqual({ width: 210, height: 150, ...spec });
  });
});

describe('TemplateSetForm 규격 카드 — 새로 입력한 값은 저장 전 범위 검사', () => {
  const base: SetFixture = { cropMarkEnabled: true, bleedMm: 3, sizeToleranceMm: 0.2 };

  function typeInto(input: HTMLInputElement, text: string): void {
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.focusOut(input);
  }

  async function expectBlocked(card: HTMLElement, errorText: string): Promise<void> {
    fireEvent.click(screen.getByText('수정').closest('button') as HTMLButtonElement);
    expect(await within(card).findByText(errorText)).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  }

  it('도련에 8 입력 → 저장 시 오류 표시, 저장 안 함', async () => {
    mocks.getById.mockResolvedValue(templateSetFixture(base));
    renderForm();
    const card = await specCard();
    const [, , bleedInput] = specNumberInputs(card);
    typeInto(bleedInput, '8');
    expect(Number(bleedInput.value)).toBe(8);
    await expectBlocked(card, BLEED_INPUT_ERROR);
  });

  it('허용오차에 7 입력 → 저장 시 오류 표시, 저장 안 함', async () => {
    mocks.getById.mockResolvedValue(templateSetFixture(base));
    renderForm();
    const card = await specCard();
    const [, , , toleranceInput] = specNumberInputs(card);
    typeInto(toleranceInput, '7');
    await expectBlocked(card, TOLERANCE_INPUT_ERROR);
  });

  it('범위 안 새 도련 1.5 입력 → 저장 payload 에 반영', async () => {
    mocks.getById.mockResolvedValue(templateSetFixture(base));
    renderForm();
    const card = await specCard();
    const [, , bleedInput] = specNumberInputs(card);
    typeInto(bleedInput, '1.5');
    await waitFor(() => expect(within(card).getByTestId('spec-work').textContent).toBe('213 × 153 mm'));
    const data = await submitAndCapture();
    expect(pickSpec(data)).toEqual({ width: 210, height: 150, bleedMm: 1.5, cropMarkEnabled: true, sizeToleranceMm: 0.2 });
  });
});

describe('TemplateSetForm 규격 카드 — 검증 안내 · 신규 세트 · 표지 없는 책모드', () => {
  it('유효 도련 0 인 일반 세트는 종전 호환 검증 안내, 도련 있음 세트는 안내 없음', async () => {
    mocks.getById.mockResolvedValue(templateSetFixture({ cropMarkEnabled: false, bleedMm: 3, sizeToleranceMm: 0.2 }));
    renderForm();
    const card = await specCard();
    expect(within(card).getByTestId('spec-validation-legacy').textContent).toBe(
      '도련 없음 세트는 종전 호환으로 사방 3mm 포함 크기도 검증을 통과하며, 재단 크기 PDF 에는 도련 권장 경고가 붙습니다',
    );
    chooseBleed(card, '있음 (재단선 마커·TrimBox 포함)');
    await waitFor(() => expect(within(card).queryByTestId('spec-validation-legacy')).toBeNull());
  });

  it('신규 세트는 저장된 도련 값 유지 안내를 띄우지 않는다', async () => {
    renderForm('/template-sets/new');
    const card = await screen.findByTestId('spec-card');
    expect(within(card).queryByText(/저장된 도련 값/)).toBeNull();
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it('책모드인데 표지 템플릿이 없는 세트는 표지 펼침면 도련 줄을 숨긴다', async () => {
    mocks.getAllTemplates.mockResolvedValue([innerPage()]);
    mocks.getById.mockResolvedValue(
      templateSetFixture(
        { cropMarkEnabled: false, bleedMm: 3, sizeToleranceMm: 0.2 },
        { type: TemplateSetType.BOOK, editorMode: EditorMode.BOOK, templates: [{ templateId: 'tpl-page', required: true }] },
      ),
    );
    renderForm();
    const card = await specCard();
    await waitFor(() => expect(within(card).getByText('표지 없음')).toBeTruthy());
    expect(within(card).queryByTestId('spec-cover-cut')).toBeNull();
  });
});

describe('TemplateSetForm 규격 카드 — 도련 토글을 바꿀 때만 매핑', () => {
  it('재단선 off · 도련 3 세트에서 「있음」 → 재단선 true + 도련 3', async () => {
    mocks.getById.mockResolvedValue(templateSetFixture({ cropMarkEnabled: false, bleedMm: 3, sizeToleranceMm: 0.2 }));
    renderForm();
    const card = await specCard();
    chooseBleed(card, '있음 (재단선 마커·TrimBox 포함)');
    await waitFor(() => expect(within(card).getByTestId('spec-work').textContent).toBe('216 × 156 mm'));
    expect(within(card).getByTestId('spec-pdf').textContent).toBe('216 × 156 mm · TrimBox 210 × 150 mm · 재단 마커');
    const data = await submitAndCapture();
    expect(pickSpec(data)).toEqual({ width: 210, height: 150, bleedMm: 3, cropMarkEnabled: true, sizeToleranceMm: 0.2 });
  });

  it('재단선 on · 도련 1 세트에서 「없음」 → 재단선 false + 도련 0, 다시 「있음」 → 도련 1 복원', async () => {
    mocks.getById.mockResolvedValue(templateSetFixture({ cropMarkEnabled: true, bleedMm: 1, sizeToleranceMm: 0.2 }));
    renderForm();
    const card = await specCard();
    expect(within(card).getByTestId('spec-work').textContent).toBe('212 × 152 mm');

    chooseBleed(card, '없음');
    await waitFor(() => expect(within(card).getByTestId('spec-work').textContent).toBe('210 × 150 mm'));
    expect(within(card).queryByText(/저장된 도련 값/)).toBeNull();

    chooseBleed(card, '있음 (재단선 마커·TrimBox 포함)');
    await waitFor(() => expect(within(card).getByTestId('spec-work').textContent).toBe('212 × 152 mm'));
    const data = await submitAndCapture();
    expect(pickSpec(data)).toEqual({ width: 210, height: 150, bleedMm: 1, cropMarkEnabled: true, sizeToleranceMm: 0.2 });
  });

  it('「없음」으로 바꾸고 저장하면 재단선 false + 도련 0', async () => {
    mocks.getById.mockResolvedValue(templateSetFixture({ cropMarkEnabled: true, bleedMm: 3, sizeToleranceMm: 0.2 }));
    renderForm();
    const card = await specCard();
    chooseBleed(card, '없음');
    const data = await submitAndCapture();
    expect(pickSpec(data)).toEqual({ width: 210, height: 150, bleedMm: 0, cropMarkEnabled: false, sizeToleranceMm: 0.2 });
  });
});

describe('TemplateSetForm 규격 카드 — 책 세트 표지 펼침면 도련', () => {
  it('재단선 off 책 세트는 표지 템플릿 저장 cutSizeMm(양변 3)을 변당 1.5mm 로 표시', async () => {
    const cover = coverSpread(3);
    mocks.getAllTemplates.mockResolvedValue([cover, innerPage()]);
    mocks.getById.mockResolvedValue(
      templateSetFixture(
        { cropMarkEnabled: false, bleedMm: 3, sizeToleranceMm: 0.2 },
        {
          type: TemplateSetType.BOOK,
          editorMode: EditorMode.BOOK,
          templates: [
            { templateId: 'tpl-cover', required: true },
            { templateId: 'tpl-page', required: false },
          ],
        },
      ),
    );
    renderForm();
    const card = await specCard();
    await waitFor(() =>
      expect(within(card).getByTestId('spec-cover-cut').textContent).toBe('변당 1.5mm (양변 합 3mm)'),
    );
    expect(within(card).getByText('표지 템플릿에 저장된 값입니다(도련 없음일 때 템플릿 값 우선).')).toBeTruthy();
    expect(within(card).getByText('표지 표지3분할')).toBeTruthy();
  });
});
