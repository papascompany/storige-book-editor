import { SheetFaceRef, SheetMapSynthesisJobData, SheetSpec } from '@storige/types';
import { DomainError, ErrorCodes } from '../common/errors';

/**
 * P2-c(2026-10-18) — 합성 mode 'sheet-map' 잡 데이터 검증(다운로드 전, 순수 함수).
 *
 * api `edit-sessions/sheet-map.ts` 의 assertSheetMapCoversPages 와 같은 규칙을 워커 로컬로 다시 구현한다
 * (패키지 경계 — api 모듈을 워커가 import 하지 않는다).
 * - sheets 비어있음 / output·duplexFlip 허용값 밖 / rotate 가 0·180 밖 → INVALID_OUTPUT_OPTIONS
 * - index ≠ 순번 / page 범위 밖·중복 / 참조 페이지 합 ≠ totalExpectedPages → PAGE_COUNT_MISMATCH
 * 두 코드 모두 synthesis-retry 의 비재시도 입력 오류(즉시 FAILED).
 */

export const SHEET_MAP_OUTPUTS: ReadonlyArray<SheetMapSynthesisJobData['output']> = ['per-sheet', 'merged-duplex'];
export const SHEET_MAP_DUPLEX_FLIPS: ReadonlyArray<SheetMapSynthesisJobData['duplexFlip']> = [
  'short-edge',
  'long-edge',
];

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function invalidOptions(message: string, detail?: Record<string, unknown>): DomainError {
  return new DomainError(ErrorCodes.INVALID_OUTPUT_OPTIONS, message, detail);
}

function pageMismatch(message: string, detail?: Record<string, unknown>): DomainError {
  return new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, message, detail);
}

/** 시트가 참조하는 면(앞, 뒤 순). 단면 시트는 앞만. */
export function sheetFaces(sheet: SheetSpec): SheetFaceRef[] {
  return sheet.back ? [sheet.front, sheet.back] : [sheet.front];
}

export function assertSheetMapJobInput(
  data: Pick<SheetMapSynthesisJobData, 'sheets' | 'output' | 'duplexFlip' | 'totalExpectedPages'>,
): void {
  const { sheets, output, duplexFlip, totalExpectedPages } = data;

  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw invalidOptions('sheet-map: sheets 가 비어 있습니다');
  }
  if (!SHEET_MAP_OUTPUTS.includes(output)) {
    throw invalidOptions(`sheet-map: output='${String(output)}' 은 허용값(per-sheet|merged-duplex)이 아닙니다`, {
      output,
    });
  }
  if (!SHEET_MAP_DUPLEX_FLIPS.includes(duplexFlip)) {
    throw invalidOptions(
      `sheet-map: duplexFlip='${String(duplexFlip)}' 은 허용값(short-edge|long-edge)이 아닙니다`,
      { duplexFlip },
    );
  }
  if (!isNonNegativeInt(totalExpectedPages) || totalExpectedPages < 1) {
    throw pageMismatch(`sheet-map: totalExpectedPages=${String(totalExpectedPages)} 는 1 이상 정수여야 합니다`, {
      expected: totalExpectedPages,
    });
  }

  const seen = new Set<number>();
  const visit = (ref: SheetFaceRef | null | undefined, where: string): void => {
    if (ref === null) return;
    if (!ref || typeof ref !== 'object') {
      throw pageMismatch(`sheet-map: ${where} 면 참조가 없습니다`, { where });
    }
    if (ref.rotate !== undefined && ref.rotate !== 0 && ref.rotate !== 180) {
      throw invalidOptions(`sheet-map: ${where} rotate=${String(ref.rotate)} 는 0 또는 180 이어야 합니다`, {
        where,
        rotate: ref.rotate,
      });
    }
    if (!isNonNegativeInt(ref.page) || ref.page >= totalExpectedPages) {
      throw pageMismatch(`sheet-map: ${where} page=${String(ref.page)} 가 0..${totalExpectedPages - 1} 범위 밖입니다`, {
        where,
        page: ref.page,
        expected: totalExpectedPages,
      });
    }
    if (seen.has(ref.page)) {
      throw pageMismatch(`sheet-map: ${where} page=${ref.page} 가 중복 참조됩니다`, { where, page: ref.page });
    }
    seen.add(ref.page);
  };

  sheets.forEach((sheet, i) => {
    if (!sheet || typeof sheet !== 'object') {
      throw pageMismatch(`sheet-map: sheets[${i}] 가 객체가 아닙니다`, { index: i });
    }
    if (sheet.index !== i) {
      throw pageMismatch(`sheet-map: sheets[${i}].index=${String(sheet.index)} 가 순번과 다릅니다`, {
        index: sheet.index,
        expected: i,
      });
    }
    visit(sheet.front, `sheets[${i}].front`);
    if (sheet.back !== null && sheet.back !== undefined) visit(sheet.back, `sheets[${i}].back`);
    else if (sheet.back === undefined) {
      throw pageMismatch(`sheet-map: sheets[${i}].back 은 면 참조 또는 null 이어야 합니다`, { index: i });
    }
  });

  if (seen.size !== totalExpectedPages) {
    throw pageMismatch(`sheet-map: 시트가 참조한 페이지 수 ${seen.size} ≠ totalExpectedPages ${totalExpectedPages}`, {
      expected: totalExpectedPages,
      got: seen.size,
    });
  }
}
