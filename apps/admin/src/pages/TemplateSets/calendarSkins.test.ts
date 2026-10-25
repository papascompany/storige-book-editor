// 캘린더 스킨 편집 헬퍼 — JSON 읽기·쓰기 왕복, 후보 필터, 호환 판정 입력, 썸네일 자동 채움.
import { describe, expect, it } from 'vitest';
import { CALENDAR_SKIN_MAX, checkCalendarSkinCompatibility, type ProductProfile } from '@storige/types';
import { CALENDAR_PROFILE_PRESETS } from './calendarProfilePresets';
import {
  SKIN_SET_NOT_FOUND,
  canAddSkin,
  filterSkinCandidates,
  moveSkin,
  nextSkinKey,
  patchSkin,
  readCalendarSkins,
  removeSkin,
  skinCompatibilityErrors,
  skinFromTemplateSet,
  skinSetInput,
  skinThumbnailFromSet,
  skinValidationErrors,
  templateDetailsFor,
  uniqueTemplateIds,
  writeCalendarSkins,
  type CalendarSkinDraft,
  type SkinCandidateSet,
  type TemplateCanvasLookup,
} from './calendarSkins';

const preset = CALENDAR_PROFILE_PRESETS[0];
const calendarProfile = (): ProductProfile => JSON.parse(JSON.stringify(preset.profile)) as ProductProfile;
const text = (v: unknown) => JSON.stringify(v, null, 2);

function draft(key: string, templateSetId: string, extra: Partial<CalendarSkinDraft> = {}): CalendarSkinDraft {
  return { key, label: key.toUpperCase(), templateSetId, extra: {}, ...extra };
}

describe('readCalendarSkins — 노출은 프로파일 kind 로만', () => {
  it('빈 글·JSON 아님·배열·캘린더 아님 → hidden', () => {
    expect(readCalendarSkins(undefined)).toEqual({ kind: 'hidden' });
    expect(readCalendarSkins('   ')).toEqual({ kind: 'hidden' });
    expect(readCalendarSkins('{ "kind": ')).toEqual({ kind: 'hidden' });
    expect(readCalendarSkins('[]')).toEqual({ kind: 'hidden' });
    expect(readCalendarSkins(text({ version: 1, kind: 'sheet', pages: { kind: 'free' } }))).toEqual({ kind: 'hidden' });
    expect(readCalendarSkins(text({ version: 1, kind: 'calendar' }))).toEqual({ kind: 'hidden' });
  });

  it('캘린더 프로파일 — skins 없음은 빈 목록, 있으면 그대로(검증 실패 값도 읽는다)', () => {
    expect(readCalendarSkins(text(calendarProfile()))).toEqual({ kind: 'calendar', skins: [] });
    const p = calendarProfile();
    (p.calendar as unknown as Record<string, unknown>).skins = [
      { key: 'a', label: '', templateSetId: 'ts-a', thumbnailUrl: '/t.png', note: 1 },
    ];
    expect(readCalendarSkins(text(p))).toEqual({
      kind: 'calendar',
      skins: [{ key: 'a', label: '', templateSetId: 'ts-a', thumbnailUrl: '/t.png', extra: { note: 1 } }],
    });
  });

  it('skins 가 배열이 아니거나 객체 아닌 원소가 있으면 unreadable', () => {
    const p = calendarProfile();
    (p.calendar as unknown as Record<string, unknown>).skins = 'x';
    expect(readCalendarSkins(text(p)).kind).toBe('unreadable');
    (p.calendar as unknown as Record<string, unknown>).skins = [1];
    expect(readCalendarSkins(text(p)).kind).toBe('unreadable');
  });
});

describe('writeCalendarSkins — calendar.skins 만 바꾸고 다른 키·순서는 그대로', () => {
  it('추가 → skins 가 calendar 끝에 붙고 나머지 키 순서·값은 같다', () => {
    const before = calendarProfile();
    const out = writeCalendarSkins(text(before), [draft('a', 'ts-a', { thumbnailUrl: '/a.png' })]);
    const parsed = JSON.parse(out as string);
    expect(Object.keys(parsed)).toEqual(Object.keys(before));
    expect(Object.keys(parsed.calendar)).toEqual([...Object.keys(before.calendar as object), 'skins']);
    expect(parsed.calendar.skins).toEqual([{ key: 'a', label: 'A', templateSetId: 'ts-a', thumbnailUrl: '/a.png' }]);
    const { skins: _skins, ...restCalendar } = parsed.calendar;
    expect({ ...parsed, calendar: restCalendar }).toEqual(before);
  });

  it('보존한 다른 키는 다시 쓰고, 목록이 비면 skins 키를 지워 원래 JSON 과 같아진다', () => {
    const before = calendarProfile();
    const withSkin = writeCalendarSkins(text(before), [draft('a', 'ts-a', { extra: { note: 1 } })]) as string;
    expect(readCalendarSkins(withSkin)).toEqual({
      kind: 'calendar',
      skins: [{ key: 'a', label: 'A', templateSetId: 'ts-a', extra: { note: 1 } }],
    });
    expect(writeCalendarSkins(withSkin, [])).toBe(text(before));
  });

  it('왕복 — 읽은 목록을 그대로 쓰면 글이 바뀌지 않는다(2칸 들여쓰기)', () => {
    const p = calendarProfile();
    (p.calendar as unknown as Record<string, unknown>).skins = [
      { key: 'a', label: 'A', templateSetId: 'ts-a' },
      { key: 'b', label: 'B', templateSetId: 'ts-b', thumbnailUrl: '/b.png' },
    ];
    const read = readCalendarSkins(text(p));
    if (read.kind !== 'calendar') throw new Error('calendar 여야 합니다');
    expect(writeCalendarSkins(text(p), read.skins)).toBe(text(p));
  });

  it('캘린더 프로파일이 아니면 쓰지 않는다(null)', () => {
    expect(writeCalendarSkins('', [draft('a', 'ts-a')])).toBeNull();
    expect(writeCalendarSkins('{bad', [draft('a', 'ts-a')])).toBeNull();
    expect(writeCalendarSkins(text({ kind: 'sheet' }), [draft('a', 'ts-a')])).toBeNull();
  });
});

describe('목록 조작', () => {
  const list = [draft('a', '1'), draft('b', '2'), draft('c', '3')];

  it('nextSkinKey — 쓰이지 않은 첫 skin-N', () => {
    expect(nextSkinKey([])).toBe('skin-1');
    expect(nextSkinKey([{ key: 'skin-1' }, { key: 'skin-3' }])).toBe('skin-2');
  });

  it('moveSkin·removeSkin·patchSkin — 새 배열, 범위 밖은 그대로', () => {
    expect(moveSkin(list, 2, 0).map((s) => s.key)).toEqual(['c', 'a', 'b']);
    expect(moveSkin(list, 0, 1).map((s) => s.key)).toEqual(['b', 'a', 'c']);
    expect(moveSkin(list, 0, 3).map((s) => s.key)).toEqual(['a', 'b', 'c']);
    expect(removeSkin(list, 1).map((s) => s.key)).toEqual(['a', 'c']);
    expect(patchSkin(list, 1, { label: '새 이름' })[1]).toEqual({ ...list[1], label: '새 이름' });
    expect(list.map((s) => s.key)).toEqual(['a', 'b', 'c']);
  });

  it('canAddSkin — 상한 미만에서만', () => {
    expect(canAddSkin(new Array(CALENDAR_SKIN_MAX - 1).fill(0))).toBe(true);
    expect(canAddSkin(new Array(CALENDAR_SKIN_MAX).fill(0))).toBe(false);
  });
});

describe('skinFromTemplateSet — 이름·썸네일 자동 채움', () => {
  it('이름 = 세트명(40자), key 자동, 썸네일 = 세트 썸네일', () => {
    const long = '가'.repeat(50);
    expect(skinFromTemplateSet({ id: 'ts-a', name: `  ${long}  `, thumbnailUrl: '/a.png' }, [{ key: 'skin-1' }])).toEqual({
      key: 'skin-2',
      label: '가'.repeat(40),
      templateSetId: 'ts-a',
      thumbnailUrl: '/a.png',
      extra: {},
    });
  });

  it('썸네일이 없거나 2048자 초과면 생략, 빈 이름은 기본 이름', () => {
    expect(skinThumbnailFromSet({ thumbnailUrl: null })).toBeUndefined();
    expect(skinThumbnailFromSet({ thumbnailUrl: '' })).toBeUndefined();
    expect(skinThumbnailFromSet({ thumbnailUrl: `/${'x'.repeat(2048)}` })).toBeUndefined();
    const skin = skinFromTemplateSet({ id: 'ts-a', name: '  ' }, []);
    expect(skin.label).toBe('디자인');
    expect('thumbnailUrl' in skin).toBe(false);
  });
});

// ─── 후보·호환 ───────────────────────────────────────────────────────────

const frames = (n: number) => ({ objects: [{ id: 'workspace' }, ...Array.from({ length: n }, (_, i) => ({ id: `f${i}`, extensionType: 'frame' }))] });

function setOf(id: string, overrides: Partial<SkinCandidateSet> = {}): SkinCandidateSet {
  return {
    id,
    name: `세트 ${id}`,
    width: preset.width,
    height: preset.height,
    siteId: 'site-a',
    productProfile: calendarProfile(),
    templates: Array.from({ length: 26 }, (_, i) => ({ templateId: `${id}-t${i}` })),
    isDeleted: false,
    bleedMm: 3,
    cropMarkEnabled: true,
    ...overrides,
  };
}

function lookupFor(...sets: SkinCandidateSet[]): Map<string, { canvasData: unknown }> {
  const map = new Map<string, { canvasData: unknown }>();
  for (const s of sets) for (const r of s.templates ?? []) map.set(r.templateId, { canvasData: frames(1) });
  return map;
}

describe('filterSkinCandidates — 같은 사이트·공유 캘린더 세트만', () => {
  it('자기 자신·다른 사이트·캘린더 아님·삭제됨 제외, 공유(null)·같은 사이트 포함', () => {
    const sets = [
      setOf('base'),
      setOf('same'),
      setOf('shared', { siteId: null }),
      setOf('shared-undef', { siteId: undefined }),
      setOf('other', { siteId: 'site-b' }),
      setOf('sheet', { productProfile: { version: 1, kind: 'sheet' } }),
      setOf('none', { productProfile: null }),
      setOf('deleted', { isDeleted: true }),
    ];
    expect(filterSkinCandidates(sets, { id: 'base', siteId: 'site-a' }).map((s) => s.id)).toEqual([
      'same',
      'shared',
      'shared-undef',
    ]);
  });

  it('기준 세트가 공유(null)면 공유 세트만', () => {
    const sets = [setOf('a'), setOf('b', { siteId: null })];
    expect(filterSkinCandidates(sets, { id: 'base', siteId: null }).map((s) => s.id)).toEqual(['b']);
  });
});

describe('호환 판정 입력 — checkCalendarSkinCompatibility 그대로', () => {
  const base = setOf('base');
  const skin = setOf('skin');

  it('templateDetailsFor — 참조 순서, 목록에 없는 템플릿은 빠진다', () => {
    const lookup: TemplateCanvasLookup = new Map([
      ['b', { canvasData: 'B' }],
      ['a', { canvasData: 'A' }],
    ]);
    expect(templateDetailsFor(['a', 'x', 'b', 'a'], lookup)).toEqual([{ canvasData: 'A' }, { canvasData: 'B' }, { canvasData: 'A' }]);
  });

  it('구조가 같으면 오류 0, skinSetInput 은 types 함수 입력과 같은 모양', () => {
    const lookup = lookupFor(base, skin);
    const baseInput = skinSetInput(base, lookup);
    expect(skinCompatibilityErrors(baseInput, skin, lookup)).toEqual([]);
    expect(skinCompatibilityErrors(baseInput, skin, lookup)).toEqual(
      checkCalendarSkinCompatibility(baseInput, skinSetInput(skin, lookup)),
    );
  });

  it('세트를 찾지 못하면 그 사유 1건', () => {
    const lookup = lookupFor(base);
    expect(skinCompatibilityErrors(skinSetInput(base, lookup), undefined, lookup)).toEqual([SKIN_SET_NOT_FOUND]);
  });

  it('사진틀 수·템플릿 누락·판형·사이트가 다르면 오류', () => {
    const lookup = lookupFor(base, skin);
    const baseInput = skinSetInput(base, lookup);
    lookup.set('skin-t3', { canvasData: frames(2) });
    expect(skinCompatibilityErrors(baseInput, skin, lookup)).toEqual(['캔버스 4: 사진틀 수가 기준과 다릅니다(기준 1 · 스킨 2)']);
    lookup.delete('skin-t5');
    expect(skinCompatibilityErrors(baseInput, skin, lookup).join('\n')).toContain('스킨 세트 템플릿 수(25)');
    const fresh = lookupFor(base, skin);
    expect(skinCompatibilityErrors(baseInput, { ...skin, width: skin.width + 1 }, fresh).join('\n')).toContain('판형');
    expect(skinCompatibilityErrors(baseInput, { ...skin, siteId: 'site-b' }, fresh)).toEqual([
      '다른 사이트의 템플릿셋은 스킨으로 지정할 수 없습니다',
    ]);
  });
});

describe('미리보기·검증 문구', () => {
  it('uniqueTemplateIds — 참조 순서, 중복 제거', () => {
    expect(uniqueTemplateIds({ templates: [{ templateId: 'c' }, { templateId: 'm' }, { templateId: 'm' }, { templateId: 'e' }] })).toEqual([
      'c',
      'm',
      'e',
    ]);
    expect(uniqueTemplateIds({ templates: null })).toEqual([]);
  });

  it('skinValidationErrors — calendar.skins 오류만', () => {
    expect(skinValidationErrors(['calendar.skins[0].key 는 …', 'pages.count …', 'calendar.skins 는 1~10개'])).toEqual([
      'calendar.skins[0].key 는 …',
      'calendar.skins 는 1~10개',
    ]);
  });
});
