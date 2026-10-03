/**
 * X1 (2026-09-30): TrimBox(재단 크기) 기준 판정 + 재단선 영역 크롭 정규화 — 공용 순수 모듈.
 *
 * 원칙(CTO 결정 X1):
 *   1) 지금 통과하는 파일의 결과·산출물은 바뀌지 않는다.
 *   2) 통과시킨 파일은 산출물이 주문 크기와 정확히 맞는다.
 *   둘 중 하나라도 보장하지 못하면 적용하지 않는다(skip + 로그).
 *
 * - 판정(evaluateTrimSizeBasis): 검증기 표준(pdf-lib)·경량(qpdf) 경로가 **같은 함수**로 판정(파리티).
 *   X1-R2: 통과 조건 = 엄격 기하 조건 + known 목표(Trim+B_order) ⊂ MediaBox. 합성 산출 박스
 *   크기는 통과 조건이 아니다(도련은 명시 BleedBox 기준 hasBleed/BLEED_MISSING 으로만 판정).
 * - 크롭(planTrimBoxCrop): 합성·변환 입력의 임시 사본에서 페이지별 MediaBox·CropBox 를
 *   'TrimBox 를 사방 균등 B 만큼 확장한 박스'로 재설정. TrimBox·BleedBox 는 유지(BleedBox 가
 *   목표 밖이면 목표로 clamp). 원본 파일에는 절대 쓰지 않는다.
 * - 산출물 크기(X1F-1, 2026-10): 잡에 `contentTrim`(주문 재단·도련)이 실린 합성·첨부 채움
 *   (merge·compose-mixed 자동조립/관리자·attach-page-pad)은 trimCropContextFromJob 으로 읽어
 *   '아는 경로'(TrimCropContext.expectedTrimMm+bleedMm)로 주문 작업사이즈(재단+2·도련)에 맞춘다.
 *   키가 없거나 값이 유효하지 않은 잡은 '모르는 경로' — 선언 도련 B = min(BleedBox 대칭 도련,
 *   3mm) 크롭 또는(BleedBox 부재·slug 증거 부족) 원본 박스 그대로 산출한다.
 *   변환(editSize '아는 경로')은 작업 크기에 정확히 맞춘다.
 * - 킬스위치: VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK(WORKER_TRIMBOX_SIZE_CHECK, 기본 ON).
 *   OFF 면 정규화 함수는 입력을 그대로 돌려준다(추가 파일·qpdf 호출 없음).
 */
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFPage } from 'pdf-lib';
import {
  VALIDATION_CONFIG,
  DEFAULT_BLEED_MM,
  LEGACY_SIZE_TOLERANCE_MM,
} from '../config/validation.config';
import {
  extractPageDictsQpdf,
  QpdfPageDict,
  QpdfPageSize,
} from './pdf-metadata-qpdf';

const execFileAsync = promisify(execFile);
const logger = new Logger('TrimBoxNormalize');
const QPDF_PATH = process.env.QPDF_PATH || 'qpdf';
const QPDF_TIMEOUT_MS = Number(process.env.QPDF_TIMEOUT_MS || 120000);

const PT_TO_MM = VALIDATION_CONFIG.PT_TO_MM;
const MM_TO_PT = 1 / PT_TO_MM;

/**
 * 모르는 경로(합성)에서 slug/재단선 영역 증거로 보는 최소 여백(mm).
 * 모든 변에서 MediaBox − TrimBox ≥ 이 값 **이고** MediaBox − 명시 BleedBox ≥ 이 값이어야 한다
 * (선언 도련 바깥의 추가 여백만 slug 로 인정 — 도련 5mm 이상 정상 파일과 구분).
 */
export const TRIMBOX_SLUG_MIN_MARGIN_MM = 5;
/** TrimBox 가로·세로 하한(mm). 미만(퇴화·극소 박스)은 비정상 입력으로 보고 판정·크롭 모두 skip. */
export const TRIMBOX_MIN_TRIM_MM = 10;
/** editSize 로 역산한 도련 B 의 상한(mm). 초과는 stale TrimBox 로 보고 skip. */
export const TRIMBOX_MAX_BLEED_MM = 5;
/** 박스 포함관계·목표 일치 판정의 좌표 오차(pt). */
export const TRIMBOX_CROP_BOX_EPS_PT = 0.5;
/**
 * hasBleed 원값 비교의 부동소수 잡음 허용(mm). pt↔mm 변환(PT_TO_MM 근사)으로 선언 2.5mm 가
 * 2.4999…mm 로 읽히는 것만 흡수한다 — 표시 반올림(0.05mm)보다 훨씬 작아 판정 치우침이 없다.
 */
export const TRIMBOX_BLEED_COMPARE_EPS_MM = 0.001;

/** 정규화된 박스(pt) — x/y 는 좌하단, width/height 는 양수. */
export interface BoxRectPt {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SizeMm {
  width: number;
  height: number;
}

/** 페이지 박스 기하(pt). trim/bleed 는 **명시 선언**만(폴백 금지). */
export interface PageBoxesPt {
  mediaBox: BoxRectPt;
  trimBox?: BoxRectPt;
  bleedBox?: BoxRectPt;
  /** 명시 ArtBox(비상속). 크롭 시 목표 밖이면 clamp 대상. 비정형이면 authoritative=false. */
  artBox?: BoxRectPt;
  /** 상속 해석된 회전(0/90/180/270). null = 해석 불가. */
  rotate: number | null;
  /** /UserUnit(부재=1). null = 해석 불가. */
  userUnit: number | null;
  /** 명시 박스 존재·부재 판정 신뢰 여부. false 면 판정·크롭 모두 적용하지 않는다. */
  authoritative: boolean;
}

// ─────────────────────────────────────────────────────────────
// 기하 헬퍼
// ─────────────────────────────────────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** [llx, lly, urx, ury](pt) → 정규화 사각형(역순 좌표 방어). */
export function normalizeBoxPt(nums: number[]): BoxRectPt {
  const [llx, lly, urx, ury] = nums;
  return {
    x: Math.min(llx, urx),
    y: Math.min(lly, ury),
    width: Math.abs(urx - llx),
    height: Math.abs(ury - lly),
  };
}

/** 사각형 → [llx, lly, urx, ury](pt, 소수 4자리). qpdf·pdf-lib 경로가 같은 수치를 쓰도록 통일. */
export function boxToArray(b: BoxRectPt): number[] {
  return [round4(b.x), round4(b.y), round4(b.x + b.width), round4(b.y + b.height)];
}

/** outer ⊇ inner (각 변 tolPt 여유). */
export function boxContains(outer: BoxRectPt, inner: BoxRectPt, tolPt: number): boolean {
  return (
    inner.x >= outer.x - tolPt &&
    inner.y >= outer.y - tolPt &&
    inner.x + inner.width <= outer.x + outer.width + tolPt &&
    inner.y + inner.height <= outer.y + outer.height + tolPt
  );
}

/** 교집합. 겹치지 않으면 null. */
export function intersectBox(a: BoxRectPt, b: BoxRectPt): BoxRectPt | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** 박스 크기(mm, 소수1자리). */
export function boxSizeMm(b: BoxRectPt): SizeMm {
  return { width: round1(b.width * PT_TO_MM), height: round1(b.height * PT_TO_MM) };
}

/** outer − inner 변별 여백(mm) [L, B, R, T]. */
export function edgeMarginsMm(outer: BoxRectPt, inner: BoxRectPt): [number, number, number, number] {
  return [
    (inner.x - outer.x) * PT_TO_MM,
    (inner.y - outer.y) * PT_TO_MM,
    (outer.x + outer.width - (inner.x + inner.width)) * PT_TO_MM,
    (outer.y + outer.height - (inner.y + inner.height)) * PT_TO_MM,
  ];
}

/** 박스를 가로 bxMm·세로 byMm 만큼 사방 대칭 확장. */
function expandBoxMm(b: BoxRectPt, bxMm: number, byMm: number): BoxRectPt {
  const dx = bxMm * MM_TO_PT;
  const dy = byMm * MM_TO_PT;
  return { x: b.x - dx, y: b.y - dy, width: b.width + 2 * dx, height: b.height + 2 * dy };
}

/**
 * 명시 BleedBox(MediaBox 로 clip) − TrimBox 의 4변 최소 여백(mm, 0 이상).
 * BleedBox 명시 부재면 0(도련 미선언).
 */
export function declaredBleedMinMm(p: PageBoxesPt): number {
  if (!p.trimBox || !p.bleedBox) return 0;
  const clipped = intersectBox(p.bleedBox, p.mediaBox);
  if (!clipped) return 0;
  return Math.max(0, Math.min(...edgeMarginsMm(clipped, p.trimBox)));
}

// ─────────────────────────────────────────────────────────────
// 박스 추출 어댑터(pdf-lib / qpdf) — 판정·크롭이 같은 입력 형태를 쓰도록
// ─────────────────────────────────────────────────────────────

function normalizeRotation(v: number): number | null {
  if (!Number.isFinite(v) || v % 90 !== 0) return null;
  return ((v % 360) + 360) % 360;
}

/**
 * pdf-lib 페이지 → PageBoxesPt.
 * ⚠️ page.getTrimBox()/getBleedBox() 는 부재 시 CropBox→MediaBox 로 폴백하므로 쓰지 않는다.
 *    page.node.TrimBox()/BleedBox() 직독(명시 부재 시 undefined). 추출 예외는 비신뢰 강등.
 */
export function pageBoxesFromPdfLib(page: PDFPage): PageBoxesPt {
  try {
    const node = page.node;
    const rectOf = (arr: PDFArray | undefined): BoxRectPt | undefined => {
      if (!arr) return undefined;
      const r = arr.asRectangle();
      return normalizeBoxPt([r.x, r.y, r.x + r.width, r.y + r.height]);
    };
    const mb = page.getMediaBox();
    const uu = node.lookup(PDFName.of('UserUnit'));
    let userUnit: number | null;
    if (uu === undefined) userUnit = 1;
    else if (uu instanceof PDFNumber && uu.asNumber() > 0) userUnit = uu.asNumber();
    else userUnit = null;
    return {
      mediaBox: normalizeBoxPt([mb.x, mb.y, mb.x + mb.width, mb.y + mb.height]),
      trimBox: rectOf(node.TrimBox()),
      bleedBox: rectOf(node.BleedBox()),
      // ArtBox 도 같은 try 안에서 읽는다 — 비정형이면 비신뢰 강등(qpdf 경로와 동일하게 skip).
      artBox: rectOf(node.ArtBox()),
      rotate: normalizeRotation(page.getRotation().angle),
      userUnit,
      authoritative: true,
    };
  } catch (error) {
    logger.warn(`pageBoxesFromPdfLib 실패 — 박스 비신뢰 강등: ${(error as Error).message}`);
    return {
      mediaBox: { x: 0, y: 0, width: 0, height: 0 },
      rotate: null,
      userUnit: null,
      authoritative: false,
    };
  }
}

/**
 * qpdf(extractPdfMetadataQpdf) 페이지 → PageBoxesPt.
 * pdfinfo 폴백(mediaBoxPt·rotate 부재) 또는 간접참조 미해석은 비신뢰.
 */
export function pageBoxesFromQpdf(p: QpdfPageSize): PageBoxesPt {
  const authoritative =
    p.boxesAuthoritative === true &&
    p.artBoxMalformed !== true &&
    Array.isArray(p.mediaBoxPt) &&
    p.rotate !== undefined &&
    p.userUnit !== undefined;
  return {
    mediaBox: p.mediaBoxPt
      ? normalizeBoxPt(p.mediaBoxPt)
      : { x: 0, y: 0, width: p.widthPt, height: p.heightPt },
    trimBox: p.trimBoxPt ? normalizeBoxPt(p.trimBoxPt) : undefined,
    bleedBox: p.bleedBoxPt ? normalizeBoxPt(p.bleedBoxPt) : undefined,
    rotate: p.rotate ?? null,
    userUnit: p.userUnit ?? null,
    authoritative,
  };
}

function pageBoxesFromQpdfDict(p: QpdfPageDict): PageBoxesPt {
  return {
    mediaBox: normalizeBoxPt(p.mediaBoxPt),
    trimBox: p.trimBoxPt ? normalizeBoxPt(p.trimBoxPt) : undefined,
    bleedBox: p.bleedBoxPt ? normalizeBoxPt(p.bleedBoxPt) : undefined,
    artBox: p.artBoxPt ? normalizeBoxPt(p.artBoxPt) : undefined,
    rotate: p.rotate,
    userUnit: p.userUnit,
    authoritative: p.boxesAuthoritative,
  };
}

// ─────────────────────────────────────────────────────────────
// 공통 기하 조건 (판정·크롭 동일)
// ─────────────────────────────────────────────────────────────

export type TrimGeometryReject =
  | 'notAuthoritative'
  | 'noTrimBox'
  | 'trimImplausible'
  | 'userUnit'
  | 'rotated'
  | 'trimOutsideMedia';

/**
 * 명시 TrimBox(가로·세로 ≥ TRIMBOX_MIN_TRIM_MM), TrimBox ⊂ MediaBox(±tol), /Rotate 90·270 아님,
 * /UserUnit = 1. (회전은 스왑하지 않는 기존 MediaBox 판정과 같은 비회전 좌표계 — 90/270 은 완화 미적용)
 */
export function checkTrimGeometry(
  p: PageBoxesPt,
  tolMm: number,
): { ok: true; trim: BoxRectPt } | { ok: false; reason: TrimGeometryReject } {
  if (!p.authoritative) return { ok: false, reason: 'notAuthoritative' };
  if (!p.trimBox) return { ok: false, reason: 'noTrimBox' };
  if (
    !(p.trimBox.width * PT_TO_MM >= TRIMBOX_MIN_TRIM_MM) ||
    !(p.trimBox.height * PT_TO_MM >= TRIMBOX_MIN_TRIM_MM)
  ) {
    return { ok: false, reason: 'trimImplausible' };
  }
  if (p.userUnit === null || Math.abs(p.userUnit - 1) > 1e-9) {
    return { ok: false, reason: 'userUnit' };
  }
  if (p.rotate === null || p.rotate === 90 || p.rotate === 270) {
    return { ok: false, reason: 'rotated' };
  }
  if (!boxContains(p.mediaBox, p.trimBox, tolMm * MM_TO_PT)) {
    return { ok: false, reason: 'trimOutsideMedia' };
  }
  return { ok: true, trim: p.trimBox };
}

// ─────────────────────────────────────────────────────────────
// 판정 (pdf-validator 표준·경량 공용)
// ─────────────────────────────────────────────────────────────

export interface TrimSizeBasisInput {
  /** 전 페이지 박스. null = 판별 불가(경량 pdfinfo 폴백 등) → 적용 안 함. */
  pages: PageBoxesPt[] | null;
  /** 문서 페이지 수(정본). pages.length 와 다르면 적용 안 함. */
  pageCount: number;
  /** 기대 재단(mm) = trimSize ?? size. */
  expectedTrimMm: SizeMm;
  /**
   * known 목표 도련 B_order(mm) = max(orderOptions.bleed ?? DEFAULT_BLEED_MM, orderOptions.bleedMm ?? 0).
   * 목표(TrimBox 를 사방 균등 B_order 확장)가 모든 페이지 MediaBox 안이어야 통과.
   */
  targetBleedMm: number;
  /** 주문 도련(mm) = orderOptions.bleed ?? DEFAULT_BLEED_MM — hasBleed 판정 기준(validateBleed 와 동일 값). */
  orderBleedMm: number;
  /** 허용오차(mm) — validatePageSize 와 동일(sizeToleranceMm ?? 1). */
  tolMm: number;
}

export type TrimSizeBasisReject =
  | TrimGeometryReject
  | 'noBoxes'
  | 'pageCountMismatch'
  | 'trimSizeMismatch'
  | 'targetOutsideMedia';

export type TrimSizeBasisResult =
  | {
      ok: true;
      /** 1쪽 TrimBox(mm, 소수1). */
      trimMm: SizeMm;
      /** 1쪽 MediaBox(mm, 소수1). */
      mediaMm: SizeMm;
      /**
       * 전 페이지·전 변의 (명시 BleedBox − TrimBox) 최소값(mm, 소수1, 0 이상).
       * BleedBox 명시가 없는 페이지가 하나라도 있으면 0.
       */
      effectiveBleedMm: number;
      /**
       * 반올림 전 원값 도련 ≥ orderBleedMm − tolMm/2(표시값 effectiveBleedMm 반올림과 무관).
       * 아니면 호출부가 기존 BLEED_MISSING 을 낸다.
       */
      hasBleed: boolean;
    }
  | { ok: false; reason: TrimSizeBasisReject; /** 1-based */ page?: number };

/**
 * TrimBox 기준 판형 통과 여부(엄격 — 페이지 혼합 불허). 모든 페이지가:
 *   명시 TrimBox ⊂ MediaBox, 비회전(90/270 아님), UserUnit 1, 비정형 박스 아님(authoritative),
 *   TrimBox 가로·세로 ≥ TRIMBOX_MIN_TRIM_MM,
 *   TrimBox ≈ 기대 재단 ±tol(가로·세로 스왑 불허),
 *   known 목표(TrimBox 를 사방 균등 targetBleedMm 확장) ⊂ MediaBox.
 * 경량 비신뢰(pages=null)·페이지 수 불일치는 적용하지 않는다.
 *
 * CTO X1-R2(2026-09-30): '모르는 경로(합성) 산출 박스 = validatePageSize 허용 크기' 조건은
 * 제거했다(운영 실측 파일 B 가 다시 SIZE_MISMATCH 가 되던 회귀). 따라서 통과 파일이라도
 * 주문 bleed 를 모르는 합성은 선언 도련 ≤ DEFAULT_BLEED_MM(3) 크롭 또는 원본 박스로 산출한다
 * (예: B+주문 bleed 1 → 216x303, 사방 4mm·BleedBox 없음 → 원본 218x305).
 * 후속: API 가 합성 잡에 주문 bleed·기대 재단을 전달하면 '아는 경로'로 정확히 맞출 수 있다.
 *
 * 도련: effectiveBleedMm = 전 페이지·전 변 (명시 BleedBox(MediaBox 로 clip) − TrimBox) 최소값,
 * BleedBox 없는 페이지가 있으면 0. hasBleed = 원값 도련 ≥ orderBleedMm − tolMm/2
 * (effectiveBleedMm 은 표시용 소수1 반올림값이며 비교에는 쓰지 않는다).
 */
export function evaluateTrimSizeBasis(input: TrimSizeBasisInput): TrimSizeBasisResult {
  const { pages, pageCount, expectedTrimMm, targetBleedMm, orderBleedMm, tolMm } = input;
  if (!pages || pages.length === 0) return { ok: false, reason: 'noBoxes' };
  if (pages.length !== pageCount) return { ok: false, reason: 'pageCountMismatch' };

  let effBleed = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const geo = checkTrimGeometry(p, tolMm);
    if (!geo.ok) return { ok: false, reason: geo.reason, page: i + 1 };
    const trimWmm = geo.trim.width * PT_TO_MM;
    const trimHmm = geo.trim.height * PT_TO_MM;
    if (
      Math.abs(trimWmm - expectedTrimMm.width) > tolMm ||
      Math.abs(trimHmm - expectedTrimMm.height) > tolMm
    ) {
      return { ok: false, reason: 'trimSizeMismatch', page: i + 1 };
    }
    const target = expandBoxMm(geo.trim, targetBleedMm, targetBleedMm);
    if (!boxContains(p.mediaBox, target, TRIMBOX_CROP_BOX_EPS_PT)) {
      return { ok: false, reason: 'targetOutsideMedia', page: i + 1 };
    }
    // BleedBox 명시 부재 페이지는 0(declaredBleedMinMm) → 문서 전체 0.
    effBleed = Math.min(effBleed, declaredBleedMinMm(p));
  }
  const p1 = pages[0];
  const rawBleedMm = Number.isFinite(effBleed) ? effBleed : 0;
  return {
    ok: true,
    trimMm: boxSizeMm(p1.trimBox as BoxRectPt),
    mediaMm: boxSizeMm(p1.mediaBox),
    // 표시(metadata.bleedSize)만 소수1 반올림 — 판정은 원값으로 한다(X1-R2 결정 원문).
    effectiveBleedMm: round1(rawBleedMm),
    hasBleed: rawBleedMm + TRIMBOX_BLEED_COMPARE_EPS_MM >= orderBleedMm - tolMm / 2,
  };
}

/**
 * 판정 실패 시 SIZE_MISMATCH details.trimBox(additive) 용 — 1쪽에 명시 TrimBox 가 있고
 * MediaBox 보다 (어느 축이든 tol 초과) 작을 때만 mm 크기를 돌려준다. 아니면 undefined
 * (TrimBox 부재·MediaBox 동일 파일은 결과 무변경).
 */
export function firstPageSmallerTrimMm(
  pages: PageBoxesPt[] | null,
  tolMm: number,
): SizeMm | undefined {
  const p1 = pages?.[0];
  if (!p1 || !p1.authoritative || !p1.trimBox) return undefined;
  const dw = (p1.mediaBox.width - p1.trimBox.width) * PT_TO_MM;
  const dh = (p1.mediaBox.height - p1.trimBox.height) * PT_TO_MM;
  if (dw > tolMm || dh > tolMm) return boxSizeMm(p1.trimBox);
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// 크롭 계획 (합성·변환 입력 정규화)
// ─────────────────────────────────────────────────────────────

export interface TrimCropContext {
  /** 변환 경로 editSize(mm, 작업사이즈). 있으면 B = (editSize − trim)/2(축별, 대칭 아니면 skip). */
  editSizeMm?: SizeMm;
  /** 기대 재단(mm)을 아는 경로 — TrimBox ≈ 기대 재단(±tol)일 때만 크롭. */
  expectedTrimMm?: SizeMm;
  /**
   * 합성 잡의 주문 도련(mm). editSize 가 없을 때 B 로 사용.
   * expectedTrimMm 와 **함께** 주어져야 '아는 경로'(slug 증거 불요)가 된다.
   */
  bleedMm?: number;
  /** 크기 비교·포함관계 허용오차(mm). 기본 LEGACY_SIZE_TOLERANCE_MM(1). */
  tolMm?: number;
  /** 이미 목표 크기면 no-op 으로 보는 허용오차(mm). 기본 tolMm. */
  noopTolMm?: number;
}

/** 아는 경로(editSize 없음 + 기대 재단 + 주문 도련 ≥ 0) 여부 — planTrimBoxCrop 의 분기와 같은 조건. */
function isKnownOrderPath(ctx: TrimCropContext): boolean {
  return (
    !ctx.editSizeMm &&
    !!ctx.expectedTrimMm &&
    typeof ctx.bleedMm === 'number' &&
    ctx.bleedMm >= 0
  );
}

// ─────────────────────────────────────────────────────────────
// 잡 페이로드 contentTrim → TrimCropContext (X1F-1, API ↔ worker 공유 계약)
// ─────────────────────────────────────────────────────────────

/** contentTrim 허용오차 상한(mm). 초과는 비정상 입력으로 보고 무시한다. */
export const TRIMBOX_MAX_TOL_MM = 5;

export type ContentTrimSource = 'templateSet' | 'bookSpec';

/** API ↔ worker 공유 계약. 큐 페이로드 키 이름은 `contentTrim`. */
export interface ContentTrimPayload {
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  /** 없으면 워커 기본 LEGACY_SIZE_TOLERANCE_MM(1). */
  tolMm?: number;
  source: ContentTrimSource;
}

export type ContentTrimRejectReason =
  | 'notObject'
  | 'trimInvalid'
  | 'bleedInvalid'
  | 'tolInvalid'
  | 'sourceInvalid';

export type ContentTrimParse =
  | { ok: true; payload: ContentTrimPayload }
  | { ok: false; reason: ContentTrimRejectReason };

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * 순수 검증(로그 없음). raw 가 undefined/null 이면 null(=키 부재). throw 하지 않는다.
 * - 숫자는 number 만(문자열 숫자 거부), 선택 필드(tolMm)의 null 은 없음으로 본다.
 * - source 는 'templateSet' | 'bookSpec' 정확 일치. 알 수 없는 키는 무시한다(전방 호환).
 */
export function parseContentTrim(raw: unknown): ContentTrimParse | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'notObject' };
  const o = raw as Record<string, unknown>;
  const { trimWidthMm, trimHeightMm, bleedMm, source } = o;
  const tolRaw = o.tolMm === null ? undefined : o.tolMm;
  if (
    !isFiniteNumber(trimWidthMm) ||
    !isFiniteNumber(trimHeightMm) ||
    trimWidthMm < TRIMBOX_MIN_TRIM_MM ||
    trimHeightMm < TRIMBOX_MIN_TRIM_MM
  ) {
    return { ok: false, reason: 'trimInvalid' };
  }
  if (!isFiniteNumber(bleedMm) || bleedMm < 0 || bleedMm > TRIMBOX_MAX_BLEED_MM) {
    return { ok: false, reason: 'bleedInvalid' };
  }
  if (
    tolRaw !== undefined &&
    (!isFiniteNumber(tolRaw) || tolRaw < 0 || tolRaw > TRIMBOX_MAX_TOL_MM)
  ) {
    return { ok: false, reason: 'tolInvalid' };
  }
  if (source !== 'templateSet' && source !== 'bookSpec') {
    return { ok: false, reason: 'sourceInvalid' };
  }
  return {
    ok: true,
    payload: {
      trimWidthMm,
      trimHeightMm,
      bleedMm,
      ...(tolRaw !== undefined ? { tolMm: tolRaw } : {}),
      source,
    },
  };
}

/**
 * 잡 페이로드의 contentTrim → TrimCropContext(아는 경로). throw 하지 않는다.
 * - 킬스위치 OFF → {} (값을 읽지 않음, 로그 없음)
 * - 키 부재 → {} (로그 없음)
 * - 무효 → {} + warn(`[TRIMBOX_CTX] ${logTag} ignored reason=…`) — 모르는 경로로 진행
 * - 유효 → { expectedTrimMm, bleedMm, tolMm(기본 1) } + log. no-op 허용오차는 tolMm 과 같다
 *   (planTrimBoxCrop 기본값).
 */
export function trimCropContextFromJob(raw: unknown, logTag = 'job'): TrimCropContext {
  if (!VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK) return {};
  let parsed: ContentTrimParse | null;
  try {
    parsed = parseContentTrim(raw);
  } catch {
    logger.warn(`[TRIMBOX_CTX] ${logTag} ignored reason=parseError`);
    return {};
  }
  if (parsed === null) return {};
  if (!parsed.ok) {
    logger.warn(`[TRIMBOX_CTX] ${logTag} ignored reason=${parsed.reason}`);
    return {};
  }
  const p = parsed.payload;
  const tolMm = p.tolMm ?? LEGACY_SIZE_TOLERANCE_MM;
  logger.log(
    `[TRIMBOX_CTX] ${logTag} source=${p.source} trim=${p.trimWidthMm}x${p.trimHeightMm} bleed=${p.bleedMm} tol=${tolMm}`,
  );
  return {
    expectedTrimMm: { width: p.trimWidthMm, height: p.trimHeightMm },
    bleedMm: p.bleedMm,
    tolMm,
  };
}

export type TrimCropSource = 'editSize' | 'orderBleed' | 'declaredBleedBox';

export type TrimCropNoneReason =
  | TrimGeometryReject
  | 'trimSizeMismatch'
  | 'noSlugMargin'
  | 'slugMarginAsymmetric'
  | 'noBleedBox'
  | 'bleedBoxNotAroundTrim'
  | 'noSlugBeyondBleed'
  | 'editSizeAsymmetric'
  | 'editSizeBleedOutOfRange'
  | 'targetEqualsMedia'
  | 'targetOutsideMedia';

export type TrimCropPlan =
  | { action: 'none'; reason: TrimCropNoneReason }
  | {
      action: 'crop';
      /** 새 MediaBox·CropBox(pt, 원 좌표계 — 원점 이동 없음). */
      target: BoxRectPt;
      /** 적용 도련 B(mm) — 가로/세로(editSize 경로만 축별로 다를 수 있음, ±tol 대칭). */
      bleedMm: { x: number; y: number };
      source: TrimCropSource;
    };

/**
 * 모르는 경로의 slug(재단선 영역) 증거 — 모두 충족해야 크롭한다.
 *   1) 모든 변에서 MediaBox − TrimBox ≥ TRIMBOX_SLUG_MIN_MARGIN_MM 이고 사방 균등(±tol)
 *      (작업사이즈 MediaBox 에 남은 비대칭 stale TrimBox 제외)
 *   2) 명시 BleedBox 가 있고(부재면 도련과 slug 를 구분할 수 없음) TrimBox 를 감싼다
 *   3) 모든 변에서 MediaBox − BleedBox ≥ TRIMBOX_SLUG_MIN_MARGIN_MM
 *      (선언 도련 **바깥**의 추가 여백만 slug 로 인정 — BleedBox≈MediaBox 인 도련 5mm 이상
 *       정상 파일·편집기 P3 산출물(MediaBox=BleedBox=작업사이즈)은 크롭하지 않는다)
 */
function checkSlugEvidence(
  p: PageBoxesPt,
  trim: BoxRectPt,
  tolMm: number,
): { ok: true } | { ok: false; reason: TrimCropNoneReason } {
  const eps = TRIMBOX_CROP_BOX_EPS_PT * PT_TO_MM;
  const margins = edgeMarginsMm(p.mediaBox, trim);
  if (Math.min(...margins) < TRIMBOX_SLUG_MIN_MARGIN_MM - eps) {
    return { ok: false, reason: 'noSlugMargin' };
  }
  if (Math.max(...margins) - Math.min(...margins) > tolMm) {
    return { ok: false, reason: 'slugMarginAsymmetric' };
  }
  if (!p.bleedBox) return { ok: false, reason: 'noBleedBox' };
  const bleed = intersectBox(p.bleedBox, p.mediaBox);
  if (!bleed || !boxContains(bleed, trim, TRIMBOX_CROP_BOX_EPS_PT)) {
    return { ok: false, reason: 'bleedBoxNotAroundTrim' };
  }
  if (Math.min(...edgeMarginsMm(p.mediaBox, bleed)) < TRIMBOX_SLUG_MIN_MARGIN_MM - eps) {
    return { ok: false, reason: 'noSlugBeyondBleed' };
  }
  return { ok: true };
}

/**
 * 페이지 1장의 크롭 계획(결정적 — 입력만으로 결정).
 *
 * 트리거(모두 충족):
 *   - 공통 기하(checkTrimGeometry): 명시 TrimBox ⊂ MediaBox, 비회전, UserUnit 1, 크기 하한
 *   - editSize 경로: (editSize − Trim)/2 가 두 축 ±tol 대칭이고 0 ≤ B ≤ TRIMBOX_MAX_BLEED_MM
 *   - 아는 경로(expectedTrimMm + bleedMm): TrimBox ≈ 기대 재단(±tol)
 *   - 모르는 경로(그 밖 — contentTrim 없는 합성): checkSlugEvidence 충족(expectedTrimMm 만 있으면
 *     TrimBox ≈ 기대 재단도 함께 요구)
 *   - |MediaBox − 목표| > noopTol (이미 목표 크기면 no-op)
 *   - 목표 ⊂ MediaBox (아니면 skip)
 * B 우선순위: editSize → 주문 bleed → min(명시 BleedBox 대칭 최소 여백, DEFAULT_BLEED_MM).
 * (BleedBox 부재 B=0 크롭은 하지 않는다 — 도련과 slug 를 구분할 수 없어 원칙 1 을 보장 못 함)
 */
export function planTrimBoxCrop(p: PageBoxesPt, ctx: TrimCropContext = {}): TrimCropPlan {
  const tolMm = ctx.tolMm ?? LEGACY_SIZE_TOLERANCE_MM;
  const noopTolMm = ctx.noopTolMm ?? tolMm;
  const geo = checkTrimGeometry(p, tolMm);
  if (!geo.ok) return { action: 'none', reason: geo.reason };
  const trim = geo.trim;
  const trimWmm = trim.width * PT_TO_MM;
  const trimHmm = trim.height * PT_TO_MM;

  let bx: number;
  let by: number;
  let source: TrimCropSource;
  if (ctx.editSizeMm) {
    const bw = (ctx.editSizeMm.width - trimWmm) / 2;
    const bh = (ctx.editSizeMm.height - trimHmm) / 2;
    if (Math.abs(bw - bh) > tolMm) return { action: 'none', reason: 'editSizeAsymmetric' };
    const eps = TRIMBOX_CROP_BOX_EPS_PT * PT_TO_MM;
    if (Math.min(bw, bh) < -eps || Math.max(bw, bh) > TRIMBOX_MAX_BLEED_MM + eps) {
      return { action: 'none', reason: 'editSizeBleedOutOfRange' };
    }
    bx = Math.max(0, bw);
    by = Math.max(0, bh);
    source = 'editSize';
  } else {
    if (ctx.expectedTrimMm) {
      if (
        Math.abs(trimWmm - ctx.expectedTrimMm.width) > tolMm ||
        Math.abs(trimHmm - ctx.expectedTrimMm.height) > tolMm
      ) {
        return { action: 'none', reason: 'trimSizeMismatch' };
      }
    }
    const orderBleed =
      typeof ctx.bleedMm === 'number' && ctx.bleedMm >= 0 ? ctx.bleedMm : undefined;
    if (!(ctx.expectedTrimMm && orderBleed !== undefined)) {
      const slug = checkSlugEvidence(p, trim, tolMm);
      if (!slug.ok) return { action: 'none', reason: slug.reason };
    }
    if (orderBleed !== undefined) {
      bx = by = orderBleed;
      source = 'orderBleed';
    } else {
      bx = by = Math.min(declaredBleedMinMm(p), DEFAULT_BLEED_MM);
      source = 'declaredBleedBox';
    }
  }

  const target = expandBoxMm(trim, bx, by);
  if (
    Math.abs(p.mediaBox.width - target.width) * PT_TO_MM <= noopTolMm &&
    Math.abs(p.mediaBox.height - target.height) * PT_TO_MM <= noopTolMm
  ) {
    return { action: 'none', reason: 'targetEqualsMedia' };
  }
  if (!boxContains(p.mediaBox, target, TRIMBOX_CROP_BOX_EPS_PT)) {
    return { action: 'none', reason: 'targetOutsideMedia' };
  }
  return { action: 'crop', target, bleedMm: { x: round1(bx), y: round1(by) }, source };
}

// ─────────────────────────────────────────────────────────────
// 정규화 적용 (파일=qpdf / 문서=pdf-lib)
// ─────────────────────────────────────────────────────────────

export interface TrimNormalizeResult {
  /** 크롭된 페이지가 1장 이상이면 true(이때 path=outputPath). */
  applied: boolean;
  pagesCropped: number;
  /** 소비할 경로 — 미적용이면 inputPath 그대로(새 파일 없음). */
  path: string;
}

type CropOk = Extract<TrimCropPlan, { action: 'crop' }>;

function summarize(plans: TrimCropPlan[]): string {
  const counts = new Map<string, number>();
  for (const pl of plans) {
    const key = pl.action === 'crop' ? `crop:${pl.source}` : pl.reason;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

function describeCrop(plans: TrimCropPlan[]): string {
  const first = plans.find((pl): pl is CropOk => pl.action === 'crop');
  if (!first) return '';
  const s = boxSizeMm(first.target);
  return `source=${first.source} bleed=${first.bleedMm.x}x${first.bleedMm.y} target=${s.width}x${s.height}mm`;
}

/**
 * skip 경고 대상 여부 — 목표가 MediaBox 밖(targetOutsideMedia)인 페이지가 있으면 true.
 * 단 아는 경로에서 MediaBox ≈ TrimBox(±tol, 재단 크기 입력)인 페이지는 제외한다(debug 로 기록 —
 * 도련 부족은 검증 단계 BLEED·SIZE 경고가 담당).
 */
function hasSkipWarning(
  pageBoxes: PageBoxesPt[],
  plans: TrimCropPlan[],
  ctx: TrimCropContext,
): boolean {
  const known = isKnownOrderPath(ctx);
  const tolMm = ctx.tolMm ?? LEGACY_SIZE_TOLERANCE_MM;
  return plans.some((pl, i) => {
    if (pl.action !== 'none' || pl.reason !== 'targetOutsideMedia') return false;
    const p = pageBoxes[i];
    if (!known || !p?.trimBox) return true;
    const mediaEqualsTrim =
      Math.abs(p.mediaBox.width - p.trimBox.width) * PT_TO_MM <= tolMm &&
      Math.abs(p.mediaBox.height - p.trimBox.height) * PT_TO_MM <= tolMm;
    return !mediaEqualsTrim;
  });
}

/** 목표 밖으로 나간 박스를 목표로 clamp(교집합). 이미 안이면 null(무변경). */
function clampToTarget(box: BoxRectPt | undefined, target: BoxRectPt): BoxRectPt | null {
  if (!box) return null;
  if (boxContains(target, box, 0.01)) return null;
  return intersectBox(box, target) ?? target;
}

async function runQpdfUpdate(patchPath: string, inputPath: string, outputPath: string): Promise<void> {
  try {
    await execFileAsync(
      QPDF_PATH,
      [`--update-from-json=${patchPath}`, '--', inputPath, outputPath],
      { timeout: QPDF_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (e: unknown) {
    // qpdf code 3 = 경고와 함께 성공(출력 생성됨). 그 외는 실패.
    const code = (e as { code?: unknown })?.code;
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false);
    if (code === 3 && exists) return;
    throw e;
  }
}

async function safeUnlink(p: string): Promise<void> {
  await fs.unlink(p).catch(() => undefined);
}

/** 산출 파일 재검사 — 크롭 대상 페이지 MediaBox 가 목표와 같은지(±0.01pt). */
async function verifyCropped(
  outputPath: string,
  expected: Map<number, BoxRectPt>,
  pageCount: number,
): Promise<boolean> {
  const out = await extractPageDictsQpdf(outputPath);
  if (!out || out.pages.length !== pageCount) return false;
  for (const [i, t] of expected) {
    const got = boxToArray(normalizeBoxPt(out.pages[i].mediaBoxPt));
    const want = boxToArray(t);
    if (got.some((v, k) => Math.abs(v - want[k]) > 0.01)) return false;
  }
  return true;
}

/**
 * 파일 경로용 정규화(qpdf --update-from-json). **inputPath 에는 절대 쓰지 않는다**
 * (downloadToTempFile 은 로컬 원본이면 원본 경로를 그대로 돌려주므로 in-place 금지).
 *
 * - 플래그 OFF / 감지 실패(비PDF·손상·qpdf 부재) / 크롭 대상 없음 → { applied:false, path:inputPath }
 *   (새 파일 없음, throw 없음).
 * - 적용 단계 실패 → 파일이 LARGE_FILE_THRESHOLD 이하면 pdf-lib 폴백, 초과면 throw
 *   (재단선이 남은 산출물을 조용히 내보내지 않기 위함). 단 아는 경로(contentTrim)에서 모르는
 *   경로({})였다면 모든 페이지가 none 이었을 입력은 throw 대신 입력 그대로(종전 결과) + warn.
 */
export async function normalizeTrimBoxFile(
  inputPath: string,
  outputPath: string,
  ctx: TrimCropContext,
  logTag: string,
): Promise<TrimNormalizeResult> {
  const passthrough: TrimNormalizeResult = { applied: false, pagesCropped: 0, path: inputPath };
  if (!VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK) return passthrough;
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    logger.warn(`[TRIMBOX_NORMALIZE] ${logTag} skip reason=sameInputOutputPath`);
    return passthrough;
  }

  const info = await extractPageDictsQpdf(inputPath);
  if (!info) {
    logger.warn(`[TRIMBOX_NORMALIZE] ${logTag} skip reason=undetectable`);
    return passthrough;
  }
  const pageBoxes = info.pages.map((pg) => pageBoxesFromQpdfDict(pg));
  const plans = pageBoxes.map((pb) => planTrimBoxCrop(pb, ctx));
  const cropIdx = plans
    .map((pl, i) => (pl.action === 'crop' ? i : -1))
    .filter((i) => i >= 0);
  if (cropIdx.length === 0) {
    if (hasSkipWarning(pageBoxes, plans, ctx)) {
      logger.warn(`[TRIMBOX_NORMALIZE] ${logTag} skip pages=${plans.length} ${summarize(plans)}`);
    } else {
      logger.debug(`[TRIMBOX_NORMALIZE] ${logTag} none pages=${plans.length} ${summarize(plans)}`);
    }
    return passthrough;
  }

  // 패치: 크롭 대상 페이지 딕셔너리만 수정(MediaBox·CropBox=목표, Bleed/ArtBox clamp).
  const patch: Record<string, { value: Record<string, unknown> }> = {};
  const expected = new Map<number, BoxRectPt>();
  for (const i of cropIdx) {
    const pg = info.pages[i];
    const plan = plans[i] as CropOk;
    if (patch[`obj:${pg.ref}`]) continue; // 동일 페이지 객체 중복 참조 방어
    const dict: Record<string, unknown> = { ...pg.dict };
    const arr = boxToArray(plan.target);
    dict['/MediaBox'] = arr;
    dict['/CropBox'] = [...arr];
    const bleed = clampToTarget(pg.bleedBoxPt ? normalizeBoxPt(pg.bleedBoxPt) : undefined, plan.target);
    if (bleed) dict['/BleedBox'] = boxToArray(bleed);
    const art = clampToTarget(pg.artBoxPt ? normalizeBoxPt(pg.artBoxPt) : undefined, plan.target);
    if (art) dict['/ArtBox'] = boxToArray(art);
    patch[`obj:${pg.ref}`] = { value: dict };
    expected.set(i, plan.target);
  }

  // 패치 JSON 은 산출 디렉터리(공개 서빙 가능) 대신 비공개 OS 임시 디렉터리에 둔다.
  const patchPath = path.join(os.tmpdir(), `trimbox-patch-${randomUUID()}.json`);
  try {
    await fs.writeFile(patchPath, JSON.stringify({ qpdf: [info.header, patch] }));
    await runQpdfUpdate(patchPath, inputPath, outputPath);
    if (!(await verifyCropped(outputPath, expected, info.pages.length))) {
      throw new Error('post-update box verification failed');
    }
  } catch (err: unknown) {
    await safeUnlink(outputPath);
    const size = await fs
      .stat(inputPath)
      .then((s) => s.size)
      .catch(() => Number.POSITIVE_INFINITY);
    const large = size > VALIDATION_CONFIG.LARGE_FILE_THRESHOLD;
    // 아는 경로 대형 파일: 모르는 경로({} — contentTrim 없는 잡)였다면 모든 페이지가 none 이었을
    // 입력(slug 증거 없음 등)은 종전 결과(입력 그대로)로 진행한다. 그 밖은 실패 처리.
    const keepInput =
      large &&
      isKnownOrderPath(ctx) &&
      pageBoxes.every((pb) => planTrimBoxCrop(pb, {}).action === 'none');
    logger.warn(
      `[TRIMBOX_NORMALIZE] ${logTag} qpdf 적용 실패(${(err as Error)?.message ?? err}) — ` +
        (!large
          ? 'pdf-lib 폴백'
          : keepInput
            ? `대형 파일 → 주문 재단 크롭 없이 입력 그대로 진행(pages=${cropIdx.length})`
            : '대형 파일 → 실패 처리'),
    );
    if (keepInput) return passthrough;
    if (large) {
      throw new Error(
        `TRIMBOX_NORMALIZE_FAILED: 재단선 영역 크롭 적용 실패(대형 파일, pages=${cropIdx.length})`,
      );
    }
    const doc = await PDFDocument.load(await fs.readFile(inputPath));
    const r = await normalizeTrimBoxPdfDoc(doc, ctx, logTag);
    if (!r.applied) return passthrough;
    try {
      await fs.writeFile(outputPath, await doc.save());
    } catch (writeErr: unknown) {
      // 부분 파일(ENOSPC 등)을 남기지 않는다 — 호출부는 applied 일 때만 출력을 추적한다.
      await safeUnlink(outputPath);
      throw writeErr;
    }
    return { applied: true, pagesCropped: r.pagesCropped, path: outputPath };
  } finally {
    await safeUnlink(patchPath);
  }

  logger.log(
    `[TRIMBOX_NORMALIZE] ${logTag} pages=${plans.length} cropped=${expected.size} ${describeCrop(plans)} (${summarize(plans)})`,
  );
  return { applied: true, pagesCropped: expected.size, path: outputPath };
}

/**
 * 버퍼(pdf-lib) 경로용 정규화 — copyPages 이전에 호출. 문서를 제자리에서 수정한다
 * (호출부가 이미 메모리에 올린 사본 — 스토리지 원본 파일은 불변).
 */
export async function normalizeTrimBoxPdfDoc(
  doc: PDFDocument,
  ctx: TrimCropContext,
  logTag: string,
): Promise<{ applied: boolean; pagesCropped: number }> {
  if (!VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK) return { applied: false, pagesCropped: 0 };
  const pages = doc.getPages();
  const plans: TrimCropPlan[] = [];
  const pageBoxes: PageBoxesPt[] = [];
  let cropped = 0;
  for (const page of pages) {
    // 박스 읽기(Trim/Bleed/ArtBox 포함)는 pageBoxesFromPdfLib 의 try 안에서만 한다 — 비정형
    // 박스는 비신뢰 강등 → none(qpdf 경로와 같은 skip). 아래 적용부는 계산된 수치만 쓴다.
    const boxes = pageBoxesFromPdfLib(page);
    const plan = planTrimBoxCrop(boxes, ctx);
    plans.push(plan);
    pageBoxes.push(boxes);
    if (plan.action !== 'crop') continue;
    const [x1, y1, x2, y2] = boxToArray(plan.target);
    const bleed = clampToTarget(boxes.bleedBox, plan.target);
    const art = clampToTarget(boxes.artBox, plan.target);
    page.setMediaBox(x1, y1, x2 - x1, y2 - y1);
    page.setCropBox(x1, y1, x2 - x1, y2 - y1);
    if (bleed) {
      const [a, b, c, d] = boxToArray(bleed);
      page.setBleedBox(a, b, c - a, d - b);
    }
    if (art) {
      const [a, b, c, d] = boxToArray(art);
      page.setArtBox(a, b, c - a, d - b);
    }
    cropped++;
  }
  if (cropped > 0) {
    logger.log(
      `[TRIMBOX_NORMALIZE] ${logTag} pages=${pages.length} cropped=${cropped} ${describeCrop(plans)} (${summarize(plans)})`,
    );
  } else if (hasSkipWarning(pageBoxes, plans, ctx)) {
    logger.warn(`[TRIMBOX_NORMALIZE] ${logTag} skip pages=${pages.length} ${summarize(plans)}`);
  } else if (plans.some((pl) => pl.action === 'none' && pl.reason === 'targetOutsideMedia')) {
    logger.debug(`[TRIMBOX_NORMALIZE] ${logTag} none pages=${pages.length} ${summarize(plans)}`);
  }
  return { applied: cropped > 0, pagesCropped: cropped };
}
