/**
 * 템플릿셋 폼 「상품 프로파일」 캘린더 스킨 편집 헬퍼 (설계 docs/CALENDAR_SKINSET_DESIGN_2026-10-24.md §4.2, 2026-10-25) — 순수 함수만.
 *
 * - 저장 필드는 프로파일 JSON 하나뿐이다. 스킨 목록은 textarea 의 `calendar.skins` 를 읽고 쓴다(단일 출처).
 * - 읽기는 JSON 파싱만 한다(검증 실패 중에도 목록이 보이도록). 검증은 폼 rule 의 `validateProductProfile` 이 맡는다.
 * - 쓰기는 사용자 조작이 있을 때만 일어난다. 다른 키·키 순서는 그대로 두고 `calendar.skins` 만 바꾼다
 *   (목록이 비면 키를 지운다 — `skins` 는 있으면 1개 이상이어야 한다).
 * - 노출 판정은 프로파일 `kind === 'calendar'` 로만 한다(TemplateSetType 분기 없음).
 * - 구조 호환은 types `checkCalendarSkinCompatibility` 를 그대로 쓴다. 사이트 일치는 서버도 저장 시 검사한다.
 */
import {
  CALENDAR_SKIN_LABEL_MAX,
  CALENDAR_SKIN_MAX,
  CALENDAR_SKIN_THUMBNAIL_URL_MAX,
  checkCalendarSkinCompatibility,
  isCalendarSkinKey,
  type CalendarSkinSetInput,
  type CalendarSkinTemplateSource,
  type TemplateRef,
} from '@storige/types';

/** 편집 중인 스킨 한 줄 — 원본 객체의 다른 키는 `extra` 로 보존한다 */
export interface CalendarSkinDraft {
  key: string;
  label: string;
  templateSetId: string;
  thumbnailUrl?: string;
  extra: Record<string, unknown>;
}

export type CalendarSkinsReadResult =
  /** textarea 가 비었거나 JSON 이 아니거나 캘린더 프로파일이 아님 → 절을 숨긴다 */
  | { kind: 'hidden' }
  /** 캘린더 프로파일이지만 `calendar.skins` 모양이 편집할 수 없는 형태(배열 아님·객체 아닌 원소) */
  | { kind: 'unreadable'; reason: string }
  | { kind: 'calendar'; skins: CalendarSkinDraft[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseRecord(text: string | null | undefined): Record<string, unknown> | null {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return null;
  try {
    const raw: unknown = JSON.parse(trimmed);
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 원시 프로파일 값이 캘린더 프로파일 모양인지(kind 와 calendar 객체만 본다) */
export function isCalendarProfileShape(profile: unknown): boolean {
  return isRecord(profile) && profile.kind === 'calendar' && isRecord(profile.calendar);
}

function toDraft(skin: Record<string, unknown>): CalendarSkinDraft {
  const { key, label, templateSetId, thumbnailUrl, ...extra } = skin;
  return {
    key: typeof key === 'string' ? key : '',
    label: typeof label === 'string' ? label : '',
    templateSetId: typeof templateSetId === 'string' ? templateSetId : '',
    ...(typeof thumbnailUrl === 'string' ? { thumbnailUrl } : {}),
    extra,
  };
}

function fromDraft(draft: CalendarSkinDraft): Record<string, unknown> {
  return {
    ...draft.extra,
    key: draft.key,
    label: draft.label,
    templateSetId: draft.templateSetId,
    ...(draft.thumbnailUrl !== undefined ? { thumbnailUrl: draft.thumbnailUrl } : {}),
  };
}

/** textarea 글 → 스킨 목록. 프로파일 검증 결과와 무관하게 JSON 만 읽는다 */
export function readCalendarSkins(text: string | null | undefined): CalendarSkinsReadResult {
  const profile = parseRecord(text);
  if (!profile || !isCalendarProfileShape(profile)) return { kind: 'hidden' };
  const skins = (profile.calendar as Record<string, unknown>).skins;
  if (skins === undefined) return { kind: 'calendar', skins: [] };
  if (!Array.isArray(skins)) {
    return { kind: 'unreadable', reason: 'calendar.skins 가 배열이 아닙니다. 프로파일 JSON 을 직접 고치세요.' };
  }
  if (!skins.every(isRecord)) {
    return { kind: 'unreadable', reason: 'calendar.skins 에 객체가 아닌 원소가 있습니다. 프로파일 JSON 을 직접 고치세요.' };
  }
  return { kind: 'calendar', skins: skins.map(toDraft) };
}

/**
 * 스킨 목록 → 새 textarea 글. 캘린더 프로파일이 아니면 null(쓰지 않음).
 * 다른 키·키 순서는 그대로 두고, 목록이 비면 `calendar.skins` 키를 지운다. 들여쓰기는 폼 초기값과 같은 2칸.
 */
export function writeCalendarSkins(text: string | null | undefined, skins: readonly CalendarSkinDraft[]): string | null {
  const profile = parseRecord(text);
  if (!profile || !isCalendarProfileShape(profile)) return null;
  const calendar = { ...(profile.calendar as Record<string, unknown>) };
  if (skins.length === 0) {
    delete calendar.skins;
  } else {
    calendar.skins = skins.map(fromDraft);
  }
  return JSON.stringify({ ...profile, calendar }, null, 2);
}

/** 원시 프로파일 객체(검증 전) — 호환 판정의 기준 세트 프로파일 입력용. 읽을 수 없으면 null */
export function parseRawProfile(text: string | null | undefined): Record<string, unknown> | null {
  return parseRecord(text);
}

/** 스킨 key = 'set-' + 세트 id 의 소문자 영숫자 앞 24자(uuid 는 하이픈을 뺀 hex 앞 24자) */
const SKIN_KEY_PREFIX = 'set-';
const SKIN_KEY_BODY_MAX = 24;

/**
 * 대상 세트 id 에서 스킨 key 를 결정적으로 만든다. 같은 세트는 늘 같은 key, 다른 세트는 다른 key 가 된다 —
 * 지운 스킨의 key 가 다른 세트에 다시 붙지 않는다(기존 세션의 skinKey 가 다른 디자인으로 해석되지 않도록).
 * 형식(`isCalendarSkinKey`)을 만족하는 key 를 만들 수 없으면 null.
 */
export function skinKeyForTemplateSet(templateSetId: string): string | null {
  const body = templateSetId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, SKIN_KEY_BODY_MAX);
  if (body.length === 0) return null;
  const key = `${SKIN_KEY_PREFIX}${body}`;
  return isCalendarSkinKey(key) ? key : null;
}

/**
 * 후보 세트를 스킨으로 추가할 수 없는 key 사유 — key 를 만들 수 없거나, 만든 key 를 현재 목록의 다른 세트 스킨이
 * 쓰고 있으면(직접 편집한 경우) 문구. 접미사를 붙여 피하지 않는다. 추가 가능하면 null.
 */
export function skinKeyBlockReason(
  set: Pick<SkinCandidateSet, 'id'>,
  skins: readonly Pick<CalendarSkinDraft, 'key' | 'label' | 'templateSetId'>[],
): string | null {
  const key = skinKeyForTemplateSet(set.id);
  if (key === null) return '세트 id 로 스킨 key 를 만들 수 없어 추가할 수 없습니다.';
  const clash = skins.find((s) => s.key === key && s.templateSetId !== set.id);
  if (clash) {
    const name = clash.label.trim() || clash.templateSetId;
    return `이 세트의 key(${key})를 다른 스킨「${name}」이 쓰고 있어 추가할 수 없습니다. 그 스킨의 key 를 고치세요.`;
  }
  return null;
}

/** 스킨 후보 세트에서 읽는 필드(공유 TemplateSet·API 목록 응답의 부분형) */
export interface SkinCandidateSet {
  id: string;
  name: string;
  width: number;
  height: number;
  siteId?: string | null;
  productProfile?: unknown;
  thumbnailUrl?: string | null;
  templates?: readonly Pick<TemplateRef, 'templateId'>[] | null;
  isDeleted?: boolean;
  bleedMm?: number | null;
  cropMarkEnabled?: boolean | null;
}

/** 썸네일 자동 채움 값 — 세트 썸네일이 1~2048자 문자열일 때만 */
export function skinThumbnailFromSet(set: Pick<SkinCandidateSet, 'thumbnailUrl'>): string | undefined {
  const url = set.thumbnailUrl;
  return typeof url === 'string' && url.length > 0 && url.length <= CALENDAR_SKIN_THUMBNAIL_URL_MAX ? url : undefined;
}

/** 후보 세트로 새 스킨 한 줄을 만든다 — key = 세트 id 에서 결정, 이름 = 세트명(40자), 썸네일 = 세트 썸네일. key 를 못 만들면 null */
export function skinFromTemplateSet(set: Pick<SkinCandidateSet, 'id' | 'name' | 'thumbnailUrl'>): CalendarSkinDraft | null {
  const key = skinKeyForTemplateSet(set.id);
  if (key === null) return null;
  const name = set.name.trim().slice(0, CALENDAR_SKIN_LABEL_MAX);
  const thumbnailUrl = skinThumbnailFromSet(set);
  return {
    key,
    label: name.length > 0 ? name : '디자인',
    templateSetId: set.id,
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    extra: {},
  };
}

/** 목록 조작 — 새 배열을 돌려준다(범위 밖이면 그대로) */
export function moveSkin<T>(skins: readonly T[], from: number, to: number): T[] {
  const next = skins.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function removeSkin<T>(skins: readonly T[], index: number): T[] {
  return skins.filter((_, i) => i !== index);
}

export function patchSkin(
  skins: readonly CalendarSkinDraft[],
  index: number,
  // key 는 대상 세트에서 정해지므로 고치지 않는다(이름만)
  patch: Partial<Pick<CalendarSkinDraft, 'label'>>,
): CalendarSkinDraft[] {
  return skins.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

export function canAddSkin(skins: readonly unknown[]): boolean {
  return skins.length < CALENDAR_SKIN_MAX;
}

/**
 * 스킨 후보 = 같은 사이트(또는 공유 siteId null) · 캘린더 프로파일 · 삭제 안 됨 · 기준 세트 자신 제외.
 * 다른 사이트 세트는 후보에 넣지 않는다(서버도 저장 시 같은 규칙으로 400).
 */
export function filterSkinCandidates<T extends SkinCandidateSet>(
  sets: readonly T[],
  base: { id: string; siteId: string | null },
): T[] {
  return sets.filter(
    (s) =>
      s.id !== base.id &&
      s.isDeleted !== true &&
      ((s.siteId ?? null) === null || (s.siteId ?? null) === base.siteId) &&
      isCalendarProfileShape(s.productProfile),
  );
}

/** 템플릿 id → canvasData 조회표(템플릿 목록 응답) */
export type TemplateCanvasLookup = ReadonlyMap<string, CalendarSkinTemplateSource>;

/** 참조 순서대로 템플릿 canvasData — 목록에 없는 템플릿(삭제 등)은 빠진다(with-templates 와 같은 규칙) */
export function templateDetailsFor(
  templateIds: readonly string[],
  lookup: TemplateCanvasLookup,
): CalendarSkinTemplateSource[] {
  const details: CalendarSkinTemplateSource[] = [];
  for (const id of templateIds) {
    const t = lookup.get(id);
    if (t) details.push(t);
  }
  return details;
}

/** 후보 세트 → 호환 판정 입력 */
export function skinSetInput(set: SkinCandidateSet, lookup: TemplateCanvasLookup): CalendarSkinSetInput {
  return {
    templateSet: {
      id: set.id,
      siteId: set.siteId ?? null,
      productProfile: set.productProfile,
      width: set.width,
      height: set.height,
      bleedMm: set.bleedMm,
      cropMarkEnabled: set.cropMarkEnabled,
    },
    templateDetails: templateDetailsFor((set.templates ?? []).map((r) => r.templateId), lookup),
  };
}

export const SKIN_SET_NOT_FOUND = '스킨 세트를 찾을 수 없습니다(삭제되었거나 다른 사이트 세트). 저장하면 서버가 거부합니다.';

/**
 * 스킨 한 줄의 호환 판정 — 세트를 목록에서 찾지 못하면 그 사유 1건, 아니면 `checkCalendarSkinCompatibility` 결과.
 * 빈 배열 = 호환.
 */
export function skinCompatibilityErrors(
  base: CalendarSkinSetInput,
  set: SkinCandidateSet | undefined,
  lookup: TemplateCanvasLookup,
): string[] {
  if (!set) return [SKIN_SET_NOT_FOUND];
  return checkCalendarSkinCompatibility(base, skinSetInput(set, lookup));
}

/** 미리보기 — 스킨 세트의 고유 템플릿(참조 순서, 중복 제거) id 목록 */
export function uniqueTemplateIds(set: Pick<SkinCandidateSet, 'templates'>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const ref of set.templates ?? []) {
    if (!seen.has(ref.templateId)) {
      seen.add(ref.templateId);
      ids.push(ref.templateId);
    }
  }
  return ids;
}

/** 프로파일 검증 오류 중 스킨 절 것만(`calendar.skins…`) */
export function skinValidationErrors(errors: readonly string[]): string[] {
  return errors.filter((e) => e.startsWith('calendar.skins'));
}
