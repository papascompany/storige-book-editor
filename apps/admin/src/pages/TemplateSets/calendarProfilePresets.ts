/**
 * 캘린더 상품 프리셋 7종 (오너 확정 2026-10-17, P1) — 템플릿셋 폼 "캘린더 프리셋 적용" 용.
 *
 * 모든 프리셋은 캔버스 26장(표지 1 + 12개월 × 2면 + 에필로그 1 = 13장 양면), 단일 PDF 26쪽.
 * 프리셋은 폼 필드 값을 채우는 출발점이며, 운영자는 적용 후 JSON 을 손으로 고칠 수 있다.
 * 동작 분기는 editorType 이 아니라 프로파일 필드(pages·sheet·calendar)로만 한다.
 */
import {
  EditorMode,
  resolveCalendarCanvasCount,
  type CalendarLayout,
  type CalendarProfile,
  type ProductProfile,
  type TemplateRef,
} from '@storige/types';

export interface CalendarProfilePreset {
  key: string;
  label: string;
  width: number;
  height: number;
  profile: ProductProfile;
}

function calendarProfile(editorType: string, layout: CalendarLayout): ProductProfile {
  return {
    version: 1,
    kind: 'calendar',
    editorType,
    pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
    sheet: {
      faces: 2,
      canvasLayout: 'canvas-pair',
      binding: 'top-ring',
      pairing: 'offset-next',
      backRotation: 0,
      duplexFlip: 'short-edge',
    },
    calendar: {
      layout,
      monthCount: 12,
      coverCanvases: 1,
      canvasesPerMonth: 2,
      epilogueCanvases: 1,
      allowedRange: { from: '2026-01', to: '2027-12' },
      weekStart: 0,
      show: { holidays: true, lunar: true, solarTerms: true },
      dataVersion: 'kr-2025-2035-v1',
    },
    output: { mode: 'single-pdf' },
  };
}

export const CALENDAR_PROFILE_PRESETS: readonly CalendarProfilePreset[] = [
  { key: 'calendar_desk_large', label: '탁상형 라지달력 (265×190)', width: 265, height: 190, profile: calendarProfile('calendar_desk_large', 'desk') },
  { key: 'calendar_desk_basic', label: '탁상형 베이직달력 (210×150)', width: 210, height: 150, profile: calendarProfile('calendar_desk_basic', 'desk') },
  { key: 'calendar_desk_tiny', label: '탁상형 티니달력 (100×125)', width: 100, height: 125, profile: calendarProfile('calendar_desk_tiny', 'desk') },
  { key: 'calendar_desk_mini', label: '탁상형 미니달력 (140×140)', width: 140, height: 140, profile: calendarProfile('calendar_desk_mini', 'desk') },
  { key: 'calendar_wall1_a3', label: '벽걸이형 원피스 A3 (297×415)', width: 297, height: 415, profile: calendarProfile('calendar_wall1_a3', 'wall-1') },
  { key: 'calendar_wall2_a4', label: '벽걸이 2단 베이직 A4 (294×210)', width: 294, height: 210, profile: calendarProfile('calendar_wall2_a4', 'wall-2') },
  { key: 'calendar_wall2_a3', label: '벽걸이 2단 라지 A3 (415×297)', width: 415, height: 297, profile: calendarProfile('calendar_wall2_a3', 'wall-2') },
];

export function findCalendarProfilePreset(key: string | undefined): CalendarProfilePreset | undefined {
  return CALENDAR_PROFILE_PRESETS.find((p) => p.key === key);
}

/**
 * 프리셋 적용 시 채울 템플릿셋 폼 필드 값(TemplateSetForm 의 Form 필드명 기준).
 * - 단일 모드·양면 원파일·내지 추가 불가·페이지 범위 [26,26]·증감 단위 없음·JSON textarea.
 * 순수 함수 — 폼 컴포넌트 테스트 없이 값 계약을 고정한다.
 */
export interface CalendarPresetFormValues {
  width: number;
  height: number;
  editorMode: EditorMode;
  pdfOutputMode: 'duplex-merged';
  canAddPage: false;
  pageCountMin: number;
  pageCountMax: number;
  pageStep: undefined;
  productProfileJson: string;
}

export function calendarPresetFormValues(preset: CalendarProfilePreset): CalendarPresetFormValues {
  const count = preset.profile.pages.count ?? resolveCalendarCanvasCount(preset.profile.calendar as CalendarProfile);
  return {
    width: preset.width,
    height: preset.height,
    editorMode: EditorMode.SINGLE,
    pdfOutputMode: 'duplex-merged',
    canAddPage: false,
    pageCountMin: count,
    pageCountMax: count,
    pageStep: undefined,
    productProfileJson: JSON.stringify(preset.profile, null, 2),
  };
}

export interface CalendarTemplateSlots {
  /** 표지 캔버스용 템플릿 ID — coverCanvases 개 */
  cover: string[];
  /** 월 면 템플릿 ID — canvasesPerMonth 개(월마다 [0], [1] 반복) */
  monthFaces: string[];
  /** 에필로그 캔버스용 템플릿 ID — epilogueCanvases 개 */
  epilogue: string[];
}

/**
 * 캘린더 프로파일의 캔버스 순서(표지 → 12개월 × 면 → 에필로그)대로 TemplateRef 배열을 만든다.
 * 같은 templateId 가 여러 캔버스에 반복 참조될 수 있다(서버 findOneWithTemplates 는 ref 별 .find 매핑).
 * 슬롯 수가 프로파일과 맞지 않으면 throw — 폼에서 사용자 메시지로 바꿔 보여 준다.
 */
export function buildCalendarTemplateRefs(
  slots: CalendarTemplateSlots,
  cal: Pick<CalendarProfile, 'coverCanvases' | 'canvasesPerMonth' | 'epilogueCanvases'>,
): TemplateRef[] {
  if (slots.cover.length !== cal.coverCanvases) {
    throw new Error(`표지 템플릿 ${cal.coverCanvases}개가 필요합니다(현재 ${slots.cover.length}개)`);
  }
  if (slots.monthFaces.length !== cal.canvasesPerMonth) {
    throw new Error(`월 면 템플릿 ${cal.canvasesPerMonth}개가 필요합니다(현재 ${slots.monthFaces.length}개)`);
  }
  if (slots.epilogue.length !== cal.epilogueCanvases) {
    throw new Error(`에필로그 템플릿 ${cal.epilogueCanvases}개가 필요합니다(현재 ${slots.epilogue.length}개)`);
  }
  const refs: TemplateRef[] = [];
  for (const templateId of slots.cover) refs.push({ templateId, required: true });
  for (let month = 0; month < 12; month += 1) {
    for (const templateId of slots.monthFaces) refs.push({ templateId, required: true });
  }
  for (const templateId of slots.epilogue) refs.push({ templateId, required: true });
  return refs;
}
