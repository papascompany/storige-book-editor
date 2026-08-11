import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { WhiteOverprintResult } from '../dto/validation-result.dto';
import { fetchQpdfJson } from './annotations-qpdf';

const execFileAsync = promisify(execFile);
const logger = new Logger('WhiteOverprintScan');

/**
 * R4b (2026-08-11) — 화이트 오버프린트 정밀 검출.
 *
 * 흰색 채움/획 객체에 오버프린트가 설정되면 인쇄 시 해당 객체가 **소멸**한다
 * (흰색=잉크 0 → 오버프린트는 '내 분판만 덮어씀' → 아무것도 안 찍힘). GWG 2022 는
 * 이를 가장 파괴적인 오버프린트 사고로 분류(R0007 텍스트=error, R0008 패스=warning).
 * 기존 detectTransparencyAndOverprint 는 'OP 존재' 만 보고 흰색 연관을 판정하지 못했다.
 *
 * 방법(정확성 우선 — 정규식 단독 불가 영역):
 *  1) `qpdf --qdf --object-streams=disable` 로 임시 QDF 생성 — 콘텐츠 스트림이
 *     비압축 평문이 된다.
 *  2) QDF 파일에 다시 `qpdf --json` — 구조(페이지→/Contents 객체번호, 페이지
 *     /Resources→/ExtGState 이름→OP 플래그)를 얻는다. QDF 자신에 대한 json 이므로
 *     객체번호가 QDF 평문과 정합(원본 번호 매핑 불필요).
 *  3) 각 페이지 콘텐츠 스트림을 연산자 수준으로 순차 스캔: q/Q 그래픽스 상태 스택,
 *     색 연산자(rg/g/k·RG/G/K), `/GSn gs` 의 OP/op 반영, Tr(텍스트 렌더 모드) 추적.
 *     페인트 연산자 실행 시점에 (흰색 채움+op) 또는 (흰색 획+OP) 이면 검출.
 *
 * v1 한계(명시): Form XObject 내부 스트림·sc/scn(비표준 색공간) 색 지정·패턴은
 * 미판정 — 보수적으로 미검출 방향(오탐 0 우선). 실패는 null 흡수(R2~R4a 규약).
 */

const QPDF_PATH = process.env.QPDF_PATH || 'qpdf';
const QPDF_TIMEOUT_MS = Number(process.env.QPDF_TIMEOUT_MS || 120000);
const QDF_MAX_BUFFER = 512 * 1024 * 1024; // QDF 평문은 원본 대비 팽창 — 여유

/** 흰색 판정 허용치 */
const WHITE_EPS = 0.005;

const isWhiteRgb = (r: number, g: number, b: number) =>
  r >= 1 - WHITE_EPS && g >= 1 - WHITE_EPS && b >= 1 - WHITE_EPS;
const isWhiteGray = (g: number) => g >= 1 - WHITE_EPS;
const isWhiteCmyk = (c: number, m: number, y: number, k: number) =>
  c <= WHITE_EPS && m <= WHITE_EPS && y <= WHITE_EPS && k <= WHITE_EPS;

interface GfxState {
  fillWhite: boolean;
  strokeWhite: boolean;
  /** 채움 오버프린트(/op — 부재 시 /OP 가 겸함, PDF 사양) */
  opFill: boolean;
  /** 획 오버프린트(/OP) */
  opStroke: boolean;
  /** 텍스트 렌더 모드(Tr) — 0=fill, 1=stroke, 2=fill+stroke, 3=invisible … */
  trMode: number;
}

export interface PageStreamInput {
  /** 페이지 번호(1-base) */
  page: number;
  /** 비압축 콘텐츠 스트림 본문(연결 완료) */
  content: string;
  /** 페이지 ExtGState 이름 → {OP?, op?} (이름은 슬래시 없이) */
  extGStates: Record<string, { OP?: boolean; op?: boolean }>;
}

/** 페인트 연산자 분류 */
const FILL_OPS = new Set(['f', 'F', 'f*', 'b', 'b*', 'B', 'B*']);
const STROKE_OPS = new Set(['S', 's', 'b', 'b*', 'B', 'B*']);
const TEXT_SHOW_OPS = new Set(['Tj', 'TJ', "'", '"']);

/**
 * 콘텐츠 스트림들을 연산자 수준으로 스캔한다(순수 — 테스트 대상).
 * 토큰화는 공백 분리 + 문자열/배열 리터럴 스킵(TJ 배열·Tj 문자열 내부의
 * 연산자 모양 텍스트가 상태를 오염시키지 않도록 괄호 깊이 추적).
 */
export function scanStreamsForWhiteOverprint(
  streams: PageStreamInput[],
): WhiteOverprintResult {
  const textPages = new Set<number>();
  const pathPages = new Set<number>();

  for (const s of streams) {
    const tokens = tokenize(s.content);
    const stack: GfxState[] = [];
    let st: GfxState = {
      fillWhite: false,
      strokeWhite: false,
      opFill: false,
      opStroke: false,
      trMode: 0,
    };

    const num = (i: number): number => Number(tokens[i]);

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      switch (t) {
        case 'q':
          stack.push({ ...st });
          break;
        case 'Q':
          st = stack.pop() ?? st;
          break;
        case 'rg':
          if (i >= 3) st.fillWhite = isWhiteRgb(num(i - 3), num(i - 2), num(i - 1));
          break;
        case 'RG':
          if (i >= 3) st.strokeWhite = isWhiteRgb(num(i - 3), num(i - 2), num(i - 1));
          break;
        case 'g':
          if (i >= 1) st.fillWhite = isWhiteGray(num(i - 1));
          break;
        case 'G':
          if (i >= 1) st.strokeWhite = isWhiteGray(num(i - 1));
          break;
        case 'k':
          if (i >= 4)
            st.fillWhite = isWhiteCmyk(num(i - 4), num(i - 3), num(i - 2), num(i - 1));
          break;
        case 'K':
          if (i >= 4)
            st.strokeWhite = isWhiteCmyk(num(i - 4), num(i - 3), num(i - 2), num(i - 1));
          break;
        case 'sc':
        case 'scn':
        case 'SC':
        case 'SCN':
        case 'cs':
        case 'CS':
          // 비표준 색공간 — 흰색 여부 미상. 보수적으로 '흰색 아님' 처리(오탐 0 우선).
          if (t === 'sc' || t === 'scn') st.fillWhite = false;
          if (t === 'SC' || t === 'SCN') st.strokeWhite = false;
          break;
        case 'Tr':
          if (i >= 1 && Number.isFinite(num(i - 1))) st.trMode = num(i - 1);
          break;
        case 'gs': {
          // 직전 토큰 = /GSn 이름
          const name = tokens[i - 1];
          if (typeof name === 'string' && name.startsWith('/')) {
            const dict = s.extGStates[name.slice(1)];
            if (dict) {
              // PDF 사양: /op 부재 시 /OP 가 채움 오버프린트를 겸한다.
              if (dict.OP !== undefined) {
                st.opStroke = dict.OP;
                if (dict.op === undefined) st.opFill = dict.OP;
              }
              if (dict.op !== undefined) st.opFill = dict.op;
            }
          }
          break;
        }
        default: {
          // 페인트 연산자 판정
          if (FILL_OPS.has(t) && st.fillWhite && st.opFill) {
            pathPages.add(s.page);
          }
          if (STROKE_OPS.has(t) && st.strokeWhite && st.opStroke) {
            pathPages.add(s.page);
          }
          if (TEXT_SHOW_OPS.has(t)) {
            const fillsText = st.trMode === 0 || st.trMode === 2 || st.trMode === 4 || st.trMode === 6;
            const strokesText = st.trMode === 1 || st.trMode === 2 || st.trMode === 5 || st.trMode === 6;
            if (
              (fillsText && st.fillWhite && st.opFill) ||
              (strokesText && st.strokeWhite && st.opStroke)
            ) {
              textPages.add(s.page);
            }
          }
        }
      }
    }
  }

  return {
    hasWhiteOverprint: textPages.size > 0 || pathPages.size > 0,
    textPages: Array.from(textPages).sort((a, b) => a - b),
    pathPages: Array.from(pathPages).sort((a, b) => a - b),
    scannedStreams: streams.length,
  };
}

/**
 * 콘텐츠 스트림 토큰화 — 문자열 (…)·16진 <…>·배열 [ ] 내부의 연산자 모양
 * 텍스트가 상태를 오염시키지 않도록 리터럴을 통째로 스킵한다(이스케이프 \( \) 처리).
 */
export function tokenize(content: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === '(') {
      // 문자열 리터럴 — 중첩 괄호·이스케이프 스킵
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        if (content[i] === '\\') i += 2;
        else {
          if (content[i] === '(') depth++;
          else if (content[i] === ')') depth--;
          i++;
        }
      }
      out.push('()'); // 자리표시(문자열 존재만 표시 — Tj 판정은 연산자로)
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i + 1);
      i = end === -1 ? n : end + 1;
      out.push('<>');
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // 일반 토큰(연산자·수치·이름·배열괄호·딕셔너리)
    let j = i;
    while (j < n && !/[\s()<]/.test(content[j])) j++;
    out.push(content.slice(i, j));
    i = j;
  }
  return out;
}

// ============================================================
// QDF 구조 조립 + 실행기
// ============================================================

const INDIRECT_REF_RE = /^\d+ \d+ R$/;

function unwrap(objmap: Record<string, any>, ref: string): any | null {
  const key = ref.startsWith('obj:') ? ref : `obj:${ref}`;
  const entry = objmap[key];
  if (entry === undefined || entry === null) return null;
  if (typeof entry === 'object' && 'value' in entry) return entry.value;
  return entry;
}

function resolveMaybeRef(objmap: Record<string, any>, v: any): any {
  if (typeof v === 'string' && INDIRECT_REF_RE.test(v)) return unwrap(objmap, v);
  return v;
}

/** QDF 평문에서 객체번호로 스트림 본문을 추출 */
export function extractStreamBody(qdfText: string, objNum: number): string | null {
  const marker = new RegExp(`(?:^|\\n)${objNum} 0 obj\\b`);
  const m = marker.exec(qdfText);
  if (!m) return null;
  const streamIdx = qdfText.indexOf('stream', m.index);
  if (streamIdx === -1) return null;
  // 'stream' 뒤 EOL 1개 스킵
  let bodyStart = streamIdx + 'stream'.length;
  if (qdfText[bodyStart] === '\r') bodyStart++;
  if (qdfText[bodyStart] === '\n') bodyStart++;
  const endIdx = qdfText.indexOf('endstream', bodyStart);
  if (endIdx === -1) return null;
  return qdfText.slice(bodyStart, endIdx);
}

/**
 * 파일을 QDF 로 평문화한 뒤 페이지 스트림·ExtGState 를 조립해 스캔한다.
 * 실패는 전부 null 흡수. 콜러가 파일 크기 게이트(LARGE_FILE_THRESHOLD)를 건다.
 */
export async function detectWhiteOverprintQpdf(
  filePath: string,
): Promise<WhiteOverprintResult | null> {
  const tmpQdf = path.join(
    os.tmpdir(),
    `wop_${Date.now()}_${Math.random().toString(36).slice(2)}.qdf.pdf`,
  );
  try {
    await execFileAsync(
      QPDF_PATH,
      ['--qdf', '--object-streams=disable', '--', filePath, tmpQdf],
      { timeout: QPDF_TIMEOUT_MS, maxBuffer: QDF_MAX_BUFFER },
    ).catch((e: any) => {
      // qpdf 경고(code 3)는 산출물이 유효 — 그대로 진행. 그 외는 재던짐.
      if (e?.code !== 3) throw e;
    });

    const doc = await fetchQpdfJson(tmpQdf);
    if (!doc) return null;
    const qdfText = new TextDecoder('latin1').decode(await fs.readFile(tmpQdf));

    const pageList: any[] = Array.isArray(doc.pages) ? doc.pages : [];
    const objmap: Record<string, any> = Array.isArray(doc.qpdf)
      ? doc.qpdf[1] ?? {}
      : {};

    const streams: PageStreamInput[] = [];
    pageList.forEach((p, idx) => {
      const pageDict = unwrap(objmap, p?.object ?? '');
      if (!pageDict) return;

      // ExtGState 이름 → OP/op 플래그
      const resources = resolveMaybeRef(objmap, pageDict['/Resources']) ?? {};
      const egsDict = resolveMaybeRef(objmap, resources['/ExtGState']) ?? {};
      const extGStates: Record<string, { OP?: boolean; op?: boolean }> = {};
      for (const [name, refOrDict] of Object.entries(egsDict)) {
        const d = resolveMaybeRef(objmap, refOrDict);
        if (d && typeof d === 'object') {
          extGStates[name.startsWith('/') ? name.slice(1) : name] = {
            OP: typeof d['/OP'] === 'boolean' ? d['/OP'] : undefined,
            op: typeof d['/op'] === 'boolean' ? d['/op'] : undefined,
          };
        }
      }
      // OP 류가 전무한 페이지는 스캔 자체가 불필요(빠른 음성)
      const hasAnyOp = Object.values(extGStates).some((g) => g.OP || g.op);
      if (!hasAnyOp) return;

      // /Contents: 단일 ref 또는 ref 배열
      const contentsRaw = pageDict['/Contents'];
      const refs: string[] = Array.isArray(contentsRaw)
        ? contentsRaw.filter((r: any) => typeof r === 'string' && INDIRECT_REF_RE.test(r))
        : typeof contentsRaw === 'string' && INDIRECT_REF_RE.test(contentsRaw)
          ? [contentsRaw]
          : [];
      const bodies = refs
        .map((r) => extractStreamBody(qdfText, parseInt(r, 10)))
        .filter((b): b is string => b !== null);
      if (bodies.length === 0) return;

      streams.push({ page: idx + 1, content: bodies.join('\n'), extGStates });
    });

    const result = scanStreamsForWhiteOverprint(streams);
    if (result.hasWhiteOverprint) {
      logger.debug(
        `white overprint: text pages [${result.textPages.join(',')}], path pages [${result.pathPages.join(',')}]`,
      );
    }
    return result;
  } catch (err: any) {
    logger.warn(
      `white overprint scan failed for '${filePath}' (${err?.code ?? err?.message}) — 경고 스킵`,
    );
    return null;
  } finally {
    await fs.unlink(tmpQdf).catch(() => {});
  }
}
