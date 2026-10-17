/**
 * 2026-10-17(낱장 분류 검증) — 편집 완료 낱장 세션의 검증 잡 분류 규칙(순수 함수).
 *
 * 배경: 편집기 낱장 세션(단면 1·양면 2·N장 낱장)은 cover 슬롯 파일로 검증되는데, 워커 cover 규칙은
 * 1·2·4쪽을 모두 통과시켜 단면 상품에 2쪽 PDF 가 들어와도 잡히지 않았다. 오너 분류(2026-10-17):
 * 낱장은 파일 슬롯과 무관하게 **정확히 세션 기록 쪽수**(orderOptions.pages)여야 하고 빈 쪽 추가는
 * 정답이 아니다(autoFixable false). 워커는 orderOptions.productKind==='sheet' 로 이 분기를 탄다.
 *
 * 판정 근거는 편집기 P0 selectSingleModePdfCanvases(apps/editor/src/utils/singleModePdfCanvases.ts)의
 * spine/wing 가드와 같은 기준이다 — 편집기는 비스프레드 단일 모드에서 spine/wing 템플릿이 없을 때만
 * 캔버스 N개를 캔버스당 1쪽 PDF 로 묶는다. 서버도 같은 조건(single 세트 + spine/wing/spread 없음)일 때만
 * "캔버스 수 = PDF 쪽수 = 기대 쪽수" 가 성립한다고 보고 sheet 로 분류한다.
 *
 * 레거시 보존: 조건이 하나라도 불명(templateTypes 조회 실패 = null)하거나 어긋나면 null → 호출부는
 * orderOptions 에 아무 키도 더하지 않는다(현행 byte-identical). 템플릿이 없거나 전부 'cover' 인 세트
 * (표지 전용 = 책 표지 편집)도 낱장이 아니므로 null.
 */
import { SessionMode } from './entities/edit-session.entity';
import type { EditSessionEntity } from './entities/edit-session.entity';

export interface SheetValidationRulesInput {
  session: Pick<EditSessionEntity, 'mode' | 'metadata'>;
  /** TemplateSetsService.findOne 결과(조회 실패 시 null) */
  templateSet: { editorMode?: string | null; pageStep?: number | null } | null;
  /** findOneWithTemplates().templateDetails[].type 목록. 조회 실패 = null → 레거시 */
  templateTypes: string[] | null;
  /** resolveInnerSpreadContentSizeMm().kind — 'none' 일 때만 낱장 후보 */
  innerLayoutKind: string;
}

export interface SheetValidationRules {
  productKind: 'sheet';
  /** 낱장 증감 단위(정수 >1 일 때만). 1 이하·미설정 = 키 없음(워커 배수 검사 없음) */
  pageStep?: number;
}

/** 낱장 PDF 로 묶을 수 없는 템플릿 타입 — 편집기 MIXED_SIZE_TYPES(spine/wing) + 스프레드(책) */
const NON_SHEET_TEMPLATE_TYPES: ReadonlySet<string> = new Set(['spine', 'wing', 'spread']);

/** 숫자 또는 숫자 문자열을 정수 >1 로 — 그 밖은 undefined(편집기 normalizePageStep 과 같은 입력 해석) */
function stepOver1(raw: unknown): number | undefined {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n > 1 ? n : undefined;
}

export function deriveSheetValidationRules(input: SheetValidationRulesInput): SheetValidationRules | null {
  const { session, templateSet, templateTypes, innerLayoutKind } = input;

  // 이 경로(createValidationJobs)는 이미 비스프레드지만, 분류 근거를 함수 안에서 닫는다.
  if (session.mode === SessionMode.SPREAD) return null;
  if (session.metadata?.spread) return null;
  if (innerLayoutKind !== 'none') return null;
  if (templateSet?.editorMode !== 'single') return null;
  if (templateTypes === null) return null;
  if (templateTypes.some((t) => NON_SHEET_TEMPLATE_TYPES.has(t))) return null;
  // 2026-10-17 운영 실측 보완: 템플릿이 하나도 없으면 판정 근거가 없고, 템플릿이 전부 'cover' 인 single
  // 세트(예: ShareSnap 하드커버 표지 전용 세트)는 책 표지 편집이지 낱장이 아니다 — 호스트가 책 쪽수를
  // pages 로 보내면 표지 1쪽이 정확 비교에 걸린다. 둘 다 null(레거시 cover 규칙 유지).
  if (templateTypes.length === 0) return null;
  if (templateTypes.every((t) => t === 'cover')) return null;

  // 호스트 주문값(metadata.orderOptions.pageStep) 우선, 없으면 템플릿셋 설정값.
  const pageStep =
    stepOver1(session.metadata?.orderOptions?.pageStep) ?? stepOver1(templateSet.pageStep);

  return { productKind: 'sheet', ...(pageStep !== undefined ? { pageStep } : {}) };
}
