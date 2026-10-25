// @vitest-environment happy-dom
// 캘린더 스킨 절 — 템플릿셋 폼 안에서 렌더. 노출 조건, 후보(같은 사이트·캘린더), 추가·삭제·정렬·이름 → JSON 반영,
// JSON → 목록 반영, 호환 안내, 서버 400 표시, 스킨 없는 세트·NULL 세트 저장 payload 바이트 동일(절 on/off 비교).
import { createTestQueryClient, renderWithAntd, stubAntdFeedback, type AntdFeedbackSpies } from '../../test/renderWithAntd';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EditorMode, TemplateSetType, TemplateType, type ProductProfile } from '@storige/types';
import { CALENDAR_PROFILE_PRESETS } from './calendarProfilePresets';
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
/** false 면 폼에 절이 없는 것과 같다(저장 payload A/B 비교용) */
const sectionSwitch = vi.hoisted(() => ({ on: true }));

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
// 프리셋 적용 안내 문구 검사용 — 실제 프리셋 목록 끝에 단면(faces 1) 14쪽 합성 프리셋을 덧붙인다(프리셋 파일은 그대로)
vi.mock('./calendarProfilePresets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./calendarProfilePresets')>();
  const base = actual.CALENDAR_PROFILE_PRESETS[0];
  const profile = JSON.parse(JSON.stringify(base.profile)) as typeof base.profile;
  profile.pages.count = 14;
  profile.sheet.faces = 1;
  const single = { ...base, key: 'test_single_14', label: '테스트 단면 14쪽', profile };
  const list = [...actual.CALENDAR_PROFILE_PRESETS, single];
  return {
    ...actual,
    CALENDAR_PROFILE_PRESETS: list,
    findCalendarProfilePreset: (key: string | undefined) => list.find((p) => p.key === key),
  };
});
vi.mock('./CalendarSkinsSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./CalendarSkinsSection')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    CalendarSkinsSection: (props: import('./CalendarSkinsSection').CalendarSkinsSectionProps) =>
      sectionSwitch.on ? createElement(actual.CalendarSkinsSection, props) : null,
  };
});

// ─── 픽스처 ──────────────────────────────────────────────────────────────

const preset = CALENDAR_PROFILE_PRESETS[0];
const PAGES = 26;
const calendarProfile = (): ProductProfile => JSON.parse(JSON.stringify(preset.profile)) as ProductProfile;
const withSkins = (skins: unknown[]): ProductProfile => {
  const p = calendarProfile();
  (p.calendar as unknown as Record<string, unknown>).skins = skins;
  return p;
};

const frames = (n: number) => ({
  objects: [{ id: 'workspace' }, ...Array.from({ length: n }, (_, i) => ({ id: `f${i}`, extensionType: 'frame' }))],
});

function template(id: string, frameCount = 1, thumbnailUrl: string | null = null) {
  return {
    id,
    name: id,
    type: TemplateType.PAGE,
    width: preset.width,
    height: preset.height,
    thumbnailUrl,
    canvasData: frames(frameCount),
    isActive: true,
    isDeleted: false,
  };
}

const refs = (prefix: string) => Array.from({ length: PAGES }, (_, i) => ({ templateId: `${prefix}-t${i}`, required: false }));

function calendarSet(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `세트 ${id}`,
    type: TemplateSetType.LEAFLET,
    editorMode: EditorMode.SINGLE,
    width: preset.width,
    height: preset.height,
    siteId: 'site-a',
    thumbnailUrl: null,
    canAddPage: false,
    pageCountRange: [PAGES, PAGES],
    pageStep: null,
    padToPageStep: false,
    templates: refs(id),
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
    productProfile: calendarProfile(),
    ...overrides,
  };
}

const SETS = {
  k1: calendarSet('k1', { name: '봄 디자인', thumbnailUrl: '/thumb/k1.png' }),
  k2: calendarSet('k2', { name: '사진틀 다름' }),
  shared: calendarSet('shared', { name: '공유 디자인', siteId: null }),
  other: calendarSet('other', { name: '다른 사이트', siteId: 'site-b' }),
  sheet: calendarSet('sheet', { name: '낱장 세트', productProfile: null }),
};

function templatesFor(...ids: string[]) {
  return ids.flatMap((id) =>
    Array.from({ length: PAGES }, (_, i) =>
      template(`${id}-t${i}`, id === 'k2' && i === 0 ? 2 : 1, id === 'k1' && i < 2 ? `/thumb/k1-${i}.png` : null),
    ),
  );
}

function setUpServer(base: ReturnType<typeof calendarSet>) {
  mocks.getById.mockResolvedValue(base);
  mocks.getAllSets.mockResolvedValue([base, ...Object.values(SETS)]);
  mocks.getAllTemplates.mockResolvedValue(templatesFor('ts-1', 'k1', 'k2', 'shared', 'other', 'sheet'));
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

async function profileTextarea(): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector('textarea#productProfileJson')).not.toBeNull());
  return document.querySelector('textarea#productProfileJson') as HTMLElement;
}

function profileValue(): Record<string, unknown> {
  return JSON.parse((document.querySelector('textarea#productProfileJson') as HTMLInputElement).value);
}

function skinsInJson(): unknown {
  return (profileValue().calendar as Record<string, unknown>).skins;
}

async function loadedSection(): Promise<HTMLElement> {
  const section = await screen.findByTestId('calendar-skins-section');
  await waitFor(() => expect(within(section).getAllByTestId('calendar-skin-candidate').length).toBeGreaterThan(0));
  return section;
}

function candidate(section: HTMLElement, name: string): HTMLElement {
  const row = within(section)
    .getAllByTestId('calendar-skin-candidate')
    .find((el) => within(el).queryByText(name));
  if (!row) throw new Error(`후보 '${name}' 가 없습니다`);
  return row;
}

function addButton(row: HTMLElement): HTMLButtonElement {
  return within(row).getByText('추가').closest('button') as HTMLButtonElement;
}

function rows(section: HTMLElement): HTMLElement[] {
  return within(section).queryAllByTestId('calendar-skin-row');
}

async function submitAndCapture(buttonText = '수정'): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByText(buttonText).closest('button') as HTMLButtonElement);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
  return (mocks.update.mock.calls[0] as [string, Record<string, unknown>])[1];
}

let feedback: AntdFeedbackSpies;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  sectionSwitch.on = true;
  mocks.update.mockResolvedValue({});
  mocks.getCategories.mockResolvedValue([]);
  mocks.listPresets.mockResolvedValue([]);
  feedback = stubAntdFeedback();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 저장 payload 불변 ──────────────────────────────────────────────────

describe('열고 그대로 저장 — 절이 있어도 payload 가 바이트 동일', () => {
  const cases: Array<[string, ReturnType<typeof calendarSet>, boolean]> = [
    ['프로파일 NULL 세트(절 숨김)', calendarSet('ts-1', { productProfile: null, canAddPage: true, pageCountRange: [10, 100] }), false],
    ['스킨 없는 캘린더 세트(절 노출)', calendarSet('ts-1'), true],
    ['스킨 있는 캘린더 세트(절 노출)', calendarSet('ts-1', { productProfile: withSkins([{ key: 'spring', label: '봄', templateSetId: 'k1' }]) }), true],
  ];

  it.each(cases)('%s', async (_name, base, sectionVisible) => {
    const capture = async (on: boolean): Promise<string> => {
      sectionSwitch.on = on;
      mocks.update.mockClear();
      setUpServer(base);
      renderForm();
      await profileTextarea();
      await screen.findByTestId('spec-card');
      if (on && sectionVisible) {
        await loadedSection();
      } else {
        await waitFor(() => expect(mocks.getAllTemplates).toHaveBeenCalled());
        expect(screen.queryByTestId('calendar-skins-section')).toBeNull();
      }
      const data = await submitAndCapture();
      cleanup();
      return JSON.stringify(data);
    };

    const withSection = await capture(true);
    expect(mocks.getAllSets).toHaveBeenCalledTimes(sectionVisible ? 1 : 0);
    const withoutSection = await capture(false);
    expect(withSection).toBe(withoutSection);
    const sent = JSON.parse(withSection) as { productProfile: unknown };
    expect(JSON.stringify(sent.productProfile)).toBe(JSON.stringify(base.productProfile));
  });
});

// ─── 노출 조건 ──────────────────────────────────────────────────────────

describe('노출 — 프로파일 kind 로만 판단', () => {
  it('NULL → 숨김, 캘린더 JSON 입력 → 보임, 사진인화 JSON → 숨김(세트 type 은 LEAFLET 그대로)', async () => {
    setUpServer(calendarSet('ts-1', { productProfile: null }));
    renderForm();
    const textarea = await profileTextarea();
    await waitFor(() => expect(mocks.getAllTemplates).toHaveBeenCalled());
    expect(screen.queryByTestId('calendar-skins-section')).toBeNull();

    fireEvent.change(textarea, { target: { value: JSON.stringify(calendarProfile(), null, 2) } });
    await loadedSection();

    fireEvent.change(textarea, { target: { value: JSON.stringify({ version: 1, kind: 'photo-print' }) } });
    await waitFor(() => expect(screen.queryByTestId('calendar-skins-section')).toBeNull());
  });

  it('신규(미저장) 세트 — 안내만, 후보 조회 없음', async () => {
    mocks.getAllTemplates.mockResolvedValue([]);
    renderForm('/template-sets/new');
    const textarea = await profileTextarea();
    fireEvent.change(textarea, { target: { value: JSON.stringify(calendarProfile(), null, 2) } });
    const section = await screen.findByTestId('calendar-skins-section');
    expect(within(section).getByText(/한 번 저장한 뒤 수정 화면에서 지정/)).toBeTruthy();
    expect(within(section).queryAllByTestId('calendar-skin-candidate')).toHaveLength(0);
    expect(mocks.getAllSets).not.toHaveBeenCalled();
  });
});

// ─── 후보·편집 ──────────────────────────────────────────────────────────

describe('후보 — 같은 사이트·공유 캘린더 세트만, 호환 안 되면 추가 불가', () => {
  it('자기 자신·다른 사이트·캘린더 아닌 세트는 후보에 없고, 사진틀 수가 다르면 사유와 함께 비활성', async () => {
    setUpServer(calendarSet('ts-1'));
    renderForm();
    const section = await loadedSection();
    const names = within(section)
      .getAllByTestId('calendar-skin-candidate')
      .map((el) => el.textContent ?? '');
    expect(names).toHaveLength(3);
    expect(names.some((t) => t.includes('봄 디자인'))).toBe(true);
    expect(names.some((t) => t.includes('공유 디자인'))).toBe(true);
    expect(names.some((t) => t.includes('다른 사이트') || t.includes('낱장 세트') || t.includes('세트 ts-1'))).toBe(false);
    expect(mocks.getAllSets).toHaveBeenCalledWith({ pageSize: 500 });

    const k2 = candidate(section, '사진틀 다름');
    expect(addButton(k2).disabled).toBe(true);
    expect(within(k2).getByText('캔버스 1: 사진틀 수가 기준과 다릅니다(기준 1 · 스킨 2)')).toBeTruthy();
    expect(addButton(candidate(section, '봄 디자인')).disabled).toBe(false);
  });
});

describe('편집 — 추가·이름·순서·삭제가 프로파일 JSON 에 그대로 쓰이고 저장된다', () => {
  it('추가 2개 → 이름·key 변경 → 순서 바꿈 → 저장 payload 반영', async () => {
    setUpServer(calendarSet('ts-1'));
    renderForm();
    const section = await loadedSection();

    fireEvent.click(addButton(candidate(section, '봄 디자인')));
    await waitFor(() => expect(rows(section)).toHaveLength(1));
    expect(skinsInJson()).toEqual([{ key: 'skin-1', label: '봄 디자인', templateSetId: 'k1', thumbnailUrl: '/thumb/k1.png' }]);
    expect(addButton(candidate(section, '봄 디자인')).disabled).toBe(true);
    expect(within(rows(section)[0]).getByTestId('calendar-skin-compat-ok')).toBeTruthy();
    expect(within(rows(section)[0]).getByTestId('calendar-skin-thumbs').querySelectorAll('img')).toHaveLength(2);

    fireEvent.click(addButton(candidate(section, '공유 디자인')));
    await waitFor(() => expect(rows(section)).toHaveLength(2));

    fireEvent.change(within(rows(section)[1]).getByLabelText('스킨 이름'), { target: { value: '겨울' } });
    fireEvent.change(within(rows(section)[1]).getByLabelText('스킨 key'), { target: { value: 'winter' } });
    await waitFor(() =>
      expect(skinsInJson()).toEqual([
        { key: 'skin-1', label: '봄 디자인', templateSetId: 'k1', thumbnailUrl: '/thumb/k1.png' },
        { key: 'winter', label: '겨울', templateSetId: 'shared' },
      ]),
    );

    fireEvent.click(within(rows(section)[1]).getByLabelText('위로'));
    await waitFor(() => expect((skinsInJson() as Array<{ key: string }>).map((s) => s.key)).toEqual(['winter', 'skin-1']));

    const data = await submitAndCapture();
    const sent = data.productProfile as { calendar: { skins: unknown } };
    expect(sent.calendar.skins).toEqual([
      { key: 'winter', label: '겨울', templateSetId: 'shared' },
      { key: 'skin-1', label: '봄 디자인', templateSetId: 'k1', thumbnailUrl: '/thumb/k1.png' },
    ]);
  });

  it('삭제 — 하나씩 지우고, 모두 지우면 skins 키를 지워 원래 프로파일과 같아진다', async () => {
    setUpServer(
      calendarSet('ts-1', {
        productProfile: withSkins([
          { key: 'spring', label: '봄', templateSetId: 'k1' },
          { key: 'winter', label: '겨울', templateSetId: 'shared' },
        ]),
      }),
    );
    renderForm();
    const section = await loadedSection();
    expect(rows(section)).toHaveLength(2);
    expect(addButton(candidate(section, '봄 디자인')).disabled).toBe(true);

    fireEvent.click(within(rows(section)[0]).getByLabelText('삭제'));
    await waitFor(() => expect(rows(section)).toHaveLength(1));
    expect(skinsInJson()).toEqual([{ key: 'winter', label: '겨울', templateSetId: 'shared' }]);
    expect(addButton(candidate(section, '봄 디자인')).disabled).toBe(false);
    fireEvent.click(within(rows(section)[0]).getByLabelText('삭제'));
    await waitFor(() => expect(rows(section)).toHaveLength(0));
    expect('skins' in (profileValue().calendar as Record<string, unknown>)).toBe(false);
    expect(profileValue()).toEqual(calendarProfile());
  });

  it('JSON 을 직접 고치면 목록이 따라온다', async () => {
    setUpServer(calendarSet('ts-1', { productProfile: withSkins([{ key: 'spring', label: '봄', templateSetId: 'k1' }]) }));
    renderForm();
    const section = await loadedSection();
    const textarea = await profileTextarea();
    expect((within(rows(section)[0]).getByLabelText('스킨 이름') as HTMLInputElement).value).toBe('봄');

    fireEvent.change(textarea, {
      target: { value: JSON.stringify(withSkins([{ key: 'spring', label: '봄 개정', templateSetId: 'k1' }]), null, 2) },
    });
    await waitFor(() =>
      expect((within(rows(section)[0]).getByLabelText('스킨 이름') as HTMLInputElement).value).toBe('봄 개정'),
    );
  });

  it('빈 이름은 형식 오류로 안내한다(폼 검증과 같은 문구)', async () => {
    setUpServer(calendarSet('ts-1', { productProfile: withSkins([{ key: 'spring', label: '봄', templateSetId: 'k1' }]) }));
    renderForm();
    const section = await loadedSection();
    fireEvent.change(within(rows(section)[0]).getByLabelText('스킨 이름'), { target: { value: '' } });
    await waitFor(() => expect(within(section).getByText('스킨 목록 형식 오류')).toBeTruthy());
    expect(within(section).getByText(/calendar\.skins\[0\]\.label/)).toBeTruthy();
  });
});

describe('저장 전 호환 안내 · 서버 400 표시', () => {
  it('목록에 없는 세트·다른 사이트 세트를 가리키는 스킨은 사유를 보이고 개수를 요약한다', async () => {
    setUpServer(
      calendarSet('ts-1', {
        productProfile: withSkins([
          { key: 'gone', label: '삭제됨', templateSetId: 'deleted-set' },
          { key: 'other', label: '다른 곳', templateSetId: 'other' },
          { key: 'spring', label: '봄', templateSetId: 'k1' },
        ]),
      }),
    );
    renderForm();
    const section = await loadedSection();
    const [gone, other, spring] = rows(section);
    expect(within(gone).getByText('목록에 없는 세트')).toBeTruthy();
    expect(within(gone).getByText(/스킨 세트를 찾을 수 없습니다/)).toBeTruthy();
    expect(within(other).getByText('다른 사이트의 템플릿셋은 스킨으로 지정할 수 없습니다')).toBeTruthy();
    expect(within(spring).getByTestId('calendar-skin-compat-ok')).toBeTruthy();
    expect(within(section).getByTestId('calendar-skins-incompatible').textContent).toContain('호환되지 않는 스킨 2개');
  });

  it('서버가 사이트 검사로 400 을 돌려주면 그 문구를 오류 메시지로 보인다', async () => {
    const serverMessage = 'calendar.skins[0].templateSetId 는 같은 사이트 또는 공유(사이트 없음) 템플릿셋을 가리켜야 합니다';
    setUpServer(calendarSet('ts-1'));
    mocks.update.mockRejectedValue({ response: { status: 400, data: { message: serverMessage } } });
    renderForm();
    const section = await loadedSection();
    fireEvent.click(addButton(candidate(section, '봄 디자인')));
    await waitFor(() => expect(rows(section)).toHaveLength(1));
    await submitAndCapture();
    await waitFor(() => expect(feedback.error).toHaveBeenCalledWith(`템플릿셋 수정 실패 — ${serverMessage}`));
  });
});

// ─── 캘린더 프리셋 적용 안내 문구 ───────────────────────────────────────

describe('캘린더 프리셋 적용 안내 — 면 수·쪽수는 적용값 그대로', () => {
  async function applyPreset(label: string): Promise<void> {
    const select = screen.getByText('캘린더 프리셋 선택').closest('.ant-select') as HTMLElement;
    fireEvent.mouseDown(select.querySelector('.ant-select-selector') as HTMLElement);
    const option = await waitFor(() => {
      const el = Array.from(document.body.querySelectorAll<HTMLElement>('.ant-select-item-option')).find(
        (o) => o.getAttribute('title') === label || o.textContent === label,
      );
      if (!el) throw new Error(`옵션 '${label}' 이 없습니다`);
      return el;
    });
    fireEvent.click(option);
    fireEvent.click(screen.getByText('캘린더 프리셋 적용').closest('button') as HTMLButtonElement);
  }

  it.each([
    [preset.label, '양면 26쪽'],
    ['테스트 단면 14쪽', '단면 14쪽'],
  ])('%s → %s', async (label, expected) => {
    mocks.getAllTemplates.mockResolvedValue([]);
    renderForm('/template-sets/new');
    await profileTextarea();
    await applyPreset(label);
    await waitFor(() =>
      expect(feedback.success).toHaveBeenCalledWith(
        `${label} 프리셋을 적용했습니다. 판형·단일 모드·${expected}·PDF 원파일·내지 추가 불가로 설정됩니다.`,
      ),
    );
  });
});
