import { execFile } from 'child_process';
import { promisify } from 'util';
import { Logger } from '@nestjs/common';

const execFileAsync = promisify(execFile);
const logger = new Logger('PdfMetadataQpdf');

/**
 * qpdf 실행 경로. Docker(alpine)·로컬 공통으로 PATH 상의 `qpdf` 를 기본 사용.
 * 환경에 따라 절대 경로가 필요하면 QPDF_PATH 로 주입한다.
 */
const QPDF_PATH = process.env.QPDF_PATH || 'qpdf';

/**
 * 자식 프로세스(qpdf) 타임아웃(ms). 2GB 파일도 메타데이터 추출은 파일 전체를
 * 파싱하지 않고 xref·페이지트리만 읽으므로 짧게 끝나지만, 손상/거대 파일을
 * 고려해 넉넉히 둔다.
 */
const QPDF_TIMEOUT_MS = Number(process.env.QPDF_TIMEOUT_MS || 120000);

/**
 * --json 출력은 객체맵을 포함하므로 매우 클 수 있다(2GB 파일이라도 JSON 자체는
 * 객체 구조 크기에만 비례하지만, 페이지 수가 수천이면 수십 MB 가능). execFile 의
 * stdout 버퍼 한도를 충분히 키운다(상수 메모리 목표와 별개로, 메타데이터 JSON은
 * 페이지 수에 비례하는 작은 크기).
 */
const QPDF_MAX_BUFFER = 256 * 1024 * 1024; // 256MB

export interface QpdfPageSize {
  /** 페이지 너비(pt) = 상속 해석된 MediaBox 의 (urx - llx). 회전 스왑 없음. */
  widthPt: number;
  /** 페이지 높이(pt) = 상속 해석된 MediaBox 의 (ury - lly). 회전 스왑 없음. */
  heightPt: number;
  // ── C-2a: crop mark 검증용 박스 기하 (qpdf --json 경로에서만 채워짐 — pdfinfo 폴백은 미지원) ──
  /** 상속 해석된 MediaBox [llx, lly, urx, ury] (pt). */
  mediaBoxPt?: number[];
  /**
   * 페이지 딕셔너리에 **명시 선언된** TrimBox [llx, lly, urx, ury] (pt).
   * TrimBox 는 PDF 사양상 비상속(non-inheritable) 속성 — parent-walk 없이 직독.
   * undefined = 명시 부재(boxesAuthoritative=true 이면 '없음' 확정).
   */
  trimBoxPt?: number[];
  /** 페이지 딕셔너리에 명시 선언된 BleedBox [llx, lly, urx, ury] (pt). 비상속 — 직독. */
  bleedBoxPt?: number[];
  /**
   * trim/bleed 박스의 존재/부재 판정이 신뢰 가능한가.
   * true  = qpdf --json 직독 성공(간접참조도 objmap 으로 해석 완료) — undefined 는 '명시 부재' 확정.
   * false/undefined = 해석 불가(박스가 미해석 간접참조 등) 또는 pdfinfo 폴백
   *   (pdfinfo 는 부재 박스를 사양 기본값으로 합성해 명시 여부 판별 불가) → 검증 skip 대상.
   */
  boxesAuthoritative?: boolean;
}

export interface QpdfMetadataResult {
  /** 메타데이터를 정상 추출했는가(pdf-lib 가 load 성공하는 수준이면 true). */
  ok: boolean;
  /** 치명적 손상 여부(qpdf --check 가 복구 불가 오류를 보고하면 true). */
  corrupted: boolean;
  /** 페이지 수. */
  pageCount: number;
  /** 페이지별 치수(pt). pdf-lib getPages()[i].getSize() 와 동일해야 한다. */
  pages: QpdfPageSize[];
}

/**
 * qpdf --json (v2) 의 객체맵에서 한 객체의 실제 딕셔너리를 꺼낸다.
 * qpdf v2 객체 표현은 `{ "value": { ...dict... } }` 래퍼를 사용한다.
 */
function unwrapObject(objmap: Record<string, any>, ref: string): any | null {
  // ref 예: "5 0 R" → 객체맵 키 "obj:5 0 R"
  const key = ref.startsWith('obj:') ? ref : `obj:${ref}`;
  const entry = objmap[key];
  if (entry === undefined || entry === null) return null;
  // v2: { value: {...} }. 방어적으로 value 가 없으면 entry 자체를 dict 로 간주.
  if (typeof entry === 'object' && 'value' in entry) return entry.value;
  return entry;
}

/**
 * 페이지 노드에서 MediaBox 를 페이지트리 상속 규칙으로 해석한다.
 *
 * PDF 사양: /MediaBox 는 상속 가능 속성(inheritable). 페이지 노드에 직접 없으면
 * /Parent(중간 Pages 노드)를 거슬러 올라가며 가장 먼저 발견되는 /MediaBox 를 쓴다.
 * pdf-lib 의 PDFPage.getSize() 도 동일하게 상속 해석된 MediaBox 를 사용한다.
 *
 * 순환 참조/누락 방어: 방문한 ref 를 추적하고, 최상위(Pages 루트)까지 못 찾으면 null.
 */
function resolveInheritedMediaBox(
  objmap: Record<string, any>,
  pageDict: any,
  pageRef: string,
): number[] | null {
  const seen = new Set<string>();
  let node: any = pageDict;
  let nodeRef: string | null = pageRef;

  while (node && typeof node === 'object') {
    const mb = node['/MediaBox'];
    if (Array.isArray(mb) && mb.length === 4) {
      // ⚠️ MediaBox 원소가 간접참조(예: `/MediaBox [0 0 4 0 R 595]`)면 qpdf objmap 이
      //    문자열 '4 0 R' 로 노출 → Number()=NaN. 하나라도 비유한수면 여기서 해석하지 않고
      //    null 반환해 pdfinfo 폴백(간접참조까지 해석)으로 위임한다. NaN 치수 유출 차단.
      const nums = mb.map((n) => (typeof n === 'number' ? n : Number(n)));
      if (nums.some((v) => !Number.isFinite(v))) return null;
      return nums;
    }
    const parentRef: string | undefined = node['/Parent'];
    if (!parentRef || typeof parentRef !== 'string') break;
    if (nodeRef) seen.add(nodeRef);
    if (seen.has(parentRef)) break; // 순환 방어
    node = unwrapObject(objmap, parentRef);
    nodeRef = parentRef;
  }
  return null;
}

/** qpdf --json 이 간접참조를 노출하는 문자열 형태("N M R") 판별. */
const INDIRECT_REF_RE = /^\d+ \d+ R$/;

/**
 * C-2a: 페이지 딕셔너리에 **명시 선언된** 비상속 박스(/TrimBox, /BleedBox)를 해석한다.
 *
 * 간접참조 함정은 기존 MediaBox 처리 방식(qpdf objmap 해석)을 재사용하되,
 * 비상속 속성이므로 parent-walk 는 하지 않는다(사양: TrimBox/BleedBox 는 상속 불가).
 *
 * 반환 규약:
 *   - undefined : 키 자체가 없음(명시 부재 확정 — TRIMBOX_MISSING 판정 근거로 사용 가능)
 *   - null      : 키는 있으나 해석 불가(미해석 간접참조/형식 오류) → 오탐 방지 위해
 *                 콜러가 boxesAuthoritative=false 로 강등해 crop mark 검증을 skip 한다.
 *   - number[]  : [llx, lly, urx, ury] 해석 성공
 */
function resolveExplicitBox(
  objmap: Record<string, any>,
  pageDict: any,
  key: '/TrimBox' | '/BleedBox',
): number[] | null | undefined {
  const raw = pageDict?.[key];
  if (raw === undefined) return undefined; // 명시 부재
  // 박스 배열 자체가 간접참조("12 0 R")인 경우 objmap 으로 해석.
  let arr: any = raw;
  if (typeof arr === 'string' && INDIRECT_REF_RE.test(arr)) {
    arr = unwrapObject(objmap, arr);
  }
  if (!Array.isArray(arr) || arr.length !== 4) return null;
  // 원소 간접참조(예: `[0 0 4 0 R 595]` → 문자열 "4 0 R")도 objmap 으로 해석.
  const nums = arr.map((el) => {
    if (typeof el === 'number') return el;
    if (typeof el === 'string' && INDIRECT_REF_RE.test(el)) {
      const v = unwrapObject(objmap, el);
      return typeof v === 'number' ? v : NaN;
    }
    return Number(el);
  });
  if (nums.some((v) => !Number.isFinite(v))) return null;
  return nums;
}

/**
 * qpdf 로 PDF 메타데이터(페이지수·페이지치수·손상여부)를 상수 메모리로 추출한다.
 *
 * ⚠️ 정확성(인쇄품질) 우선: pdf-lib 의 `PDFDocument.load(bytes)` →
 *   `getPages()[i].getSize()` 와 **완전히 동일한** pageCount·각 페이지 width/height(pt)
 *   를 내야 한다. pdf-lib getSize 는 상속 해석된 MediaBox 의 (urx-llx, ury-lly) 이며
 *   회전(/Rotate)에 따른 폭·높이 스왑은 하지 않는다 → 여기서도 스왑하지 않는다.
 *
 * 기존 전체버퍼 경로(pdf-validator.service.ts:84, PDFDocument.load(전체바이트))는
 * 2GB 에서 OOM 이므로, 이 함수는 새 ON 경로 전용이다. 기존 OFF 경로는 불변.
 *
 * @param filePath 로컬 파일 경로(이미 디스크에 존재해야 함)
 */
export async function extractPdfMetadataQpdf(
  filePath: string,
): Promise<QpdfMetadataResult> {
  // 1) 손상 검증은 '정보용'으로만 본다(게이트로 쓰지 않음).
  //    ⚠️ qpdf --check 가 code 2(예: /Root 참조 깨짐)를 내도 기존 OFF 경로 pdf-lib
  //    (PDFDocument.load, 기본 옵션)는 Catalog/Pages 스캔 복구로 정상 load 하는 경우가
  //    있다(CORRUPT-FP — 적대검증 적발). 파리티(OFF=pdf-lib)를 맞추려면 손상을
  //    '--check 코드'가 아니라 '페이지를 실제로 추출할 수 있는가'로 판정해야 한다.
  //    → --check 는 로깅만 하고, 손상 최종판정은 아래 페이지 추출 성공 여부로 한다.
  let checkCode: number | undefined;
  try {
    await execFileAsync(QPDF_PATH, ['--check', '--', filePath], {
      timeout: QPDF_TIMEOUT_MS,
      maxBuffer: QPDF_MAX_BUFFER,
    });
  } catch (err: any) {
    checkCode = typeof err?.code === 'number' ? err.code : undefined;
    logger.debug(
      `qpdf --check 비정상 종료(code=${checkCode}) — 정보용(페이지 추출로 손상 최종판정)`,
    );
  }

  // 2) 페이지수: qpdf --show-npages (가장 가볍고 정확).
  //    이것조차 못 읽으면 pdf-lib 도 load 실패하는 수준(암호화/절단 등) → 손상.
  let pageCount = 0;
  try {
    const { stdout } = await execFileAsync(
      QPDF_PATH,
      ['--show-npages', '--', filePath],
      { timeout: QPDF_TIMEOUT_MS, maxBuffer: QPDF_MAX_BUFFER },
    );
    pageCount = parseInt(stdout.trim(), 10);
    if (!Number.isFinite(pageCount) || pageCount < 0) pageCount = 0;
  } catch (err: any) {
    logger.warn(
      `qpdf --show-npages 실패(checkCode=${checkCode}): ${err?.message ?? err} → 손상 간주`,
    );
  }

  if (pageCount <= 0) {
    // 페이지 수를 못 얻음 = 복구 불가 손상(pdf-lib 도 거부하는 수준) → corrupted.
    return { ok: false, corrupted: true, pageCount: 0, pages: [] };
  }

  // 3) 페이지별 치수: qpdf --json 객체맵에서 상속 해석된 MediaBox 추출.
  //    --json-key 로 출력을 pages/qpdf(객체맵) 로 한정해 JSON 크기를 줄인다.
  const pages: QpdfPageSize[] = [];
  try {
    // qpdf 가 경고(code=3)와 함께 성공하는 PDF(스트림 길이 복구 등)는 흔하다.
    // 이 경우 execFile 은 throw 하지만 err.stdout 에 '완전히 유효한' JSON 이 들어있다.
    // pdfinfo 가 없는 환경(alpine)에서도 1차 경로가 끊기지 않도록 stdout 을 회수한다.
    let stdout: string;
    try {
      const res = await execFileAsync(
        QPDF_PATH,
        ['--json', '--json-key=pages', '--json-key=qpdf', '--', filePath],
        { timeout: QPDF_TIMEOUT_MS, maxBuffer: QPDF_MAX_BUFFER },
      );
      stdout = res.stdout;
    } catch (e: any) {
      // 경고만(code=3)이고 stdout 이 있으면 그대로 파싱. 그 외(code=2 등)는 재던짐.
      if (e?.code === 3 && typeof e.stdout === 'string' && e.stdout.length > 0) {
        logger.debug(`qpdf --json 경고(비치명) 출력 회수: ${filePath}`);
        stdout = e.stdout;
      } else {
        throw e;
      }
    }
    const doc = JSON.parse(stdout);
    const pageList: any[] = Array.isArray(doc.pages) ? doc.pages : [];
    // qpdf v2: doc.qpdf = [ <헤더>, <객체맵> ]. 객체맵은 인덱스 1.
    const objmap: Record<string, any> = Array.isArray(doc.qpdf)
      ? doc.qpdf[1] ?? {}
      : {};

    for (const p of pageList) {
      const ref: string = p.object; // 예: "5 0 R"
      const pageDict = unwrapObject(objmap, ref);
      if (!pageDict) {
        // 객체맵에서 페이지 딕셔너리를 못 찾으면 폴백 필요 → 예외 던져 pdfinfo 로.
        throw new Error(`page object not found in objmap: ${ref}`);
      }
      const mb = resolveInheritedMediaBox(objmap, pageDict, ref);
      if (!mb) {
        throw new Error(`MediaBox unresolved for page object: ${ref}`);
      }
      const [llx, lly, urx, ury] = mb;
      // pdf-lib getSize 와 동일: (urx-llx, ury-lly). 회전 스왑 없음.
      const widthPt = urx - llx;
      const heightPt = ury - lly;
      // 비유한수(간접참조 잔류 등) 방어 — NaN 치수가 ok:true 로 새어나가지 않게 폴백 위임.
      if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt)) {
        throw new Error(`non-finite MediaBox for page object: ${ref}`);
      }

      // C-2a: 비상속 박스(TrimBox/BleedBox) 명시 선언 직독 — 실패해도 치수 추출은 불변.
      // null(해석 불가)이 하나라도 있으면 boxesAuthoritative=false 로 강등해
      // 검증기가 오탐(TRIMBOX_MISSING 허위 경고) 없이 skip 하게 한다.
      const trimBox = resolveExplicitBox(objmap, pageDict, '/TrimBox');
      const bleedBox = resolveExplicitBox(objmap, pageDict, '/BleedBox');
      const boxesAuthoritative = trimBox !== null && bleedBox !== null;

      pages.push({
        widthPt,
        heightPt,
        mediaBoxPt: mb,
        trimBoxPt: trimBox ?? undefined,
        bleedBoxPt: bleedBox ?? undefined,
        boxesAuthoritative,
      });
    }

    // pageCount 와 페이지치수 배열 길이 정합성 보강(npages 우선이 정본).
    if (pages.length !== pageCount && pageCount > 0) {
      logger.debug(
        `pages.length(${pages.length}) != npages(${pageCount}); npages 우선`,
      );
    }
  } catch (err: any) {
    // qpdf --json 경로 실패(객체맵 구조 변동·MediaBox 미해석 등) → pdfinfo 폴백.
    logger.warn(
      `qpdf --json 치수 추출 실패, pdfinfo 폴백 시도: ${err?.message ?? err}`,
    );
    const fallback = await extractPageSizesPdfinfo(filePath, pageCount);
    if (fallback) {
      return { ok: true, corrupted: false, pageCount, pages: fallback };
    }
    // 페이지수는 얻었으나(=로드 가능) 치수만 못 구함 → '손상' 아님.
    // ok:false·corrupted:false 로 두어, 검증기 ON 경로가 이 파일만 OFF 버퍼 경로로
    // 폴백(치수기반 검증 수행)하도록 한다 — 로드 가능한 파일을 손상으로 거부하지 않는다.
    return { ok: false, corrupted: false, pageCount, pages: [] };
  }

  return { ok: true, corrupted: false, pageCount, pages };
}

/**
 * pdfinfo 폴백: qpdf --json 으로 페이지 치수를 못 얻을 때 사용.
 *
 * ⚠️ 폴백 한계와 파리티 주의:
 *   - `pdfinfo -box -l <n> -f 1` 은 MediaBox 를 'Page N MediaBox: llx lly urx ury' 로
 *     출력하며, 이는 pdf-lib 가 쓰는 상속 해석된 MediaBox 와 동일(소수 표현은
 *     pdfinfo 가 자체 반올림할 수 있어 소수 1자리 비교 권장).
 *   - pdfinfo 는 CropBox 가 아니라 MediaBox 키를 별도로 내주므로 MediaBox 만 읽는다.
 *   - 단, pdfinfo 가 없거나(미설치) 출력 포맷이 다르면 null 을 반환한다.
 *
 * 주의: 단일 'Page size:' 줄(첫 페이지만)은 모든 페이지에 동일 적용하면 혼합치수
 * PDF 에서 파리티가 깨지므로 사용하지 않는다. 반드시 페이지별 -box 를 사용한다.
 */
/**
 * 트랙 B-(f): getPdfInfo(ghostscript.ts) 의 상수메모리 대체.
 *
 * 기존 getPdfInfo 는 pdf-lib `PDFDocument.load(전체바이트)` 로 첫 페이지를 실측 →
 * 2GB 에서 OOM. 이 함수는 extractPdfMetadataQpdf(qpdf, 파일기반) 로 첫 페이지 치수를
 * 얻어 **getPdfInfo 와 동일한 산출**(pageCount·width/height mm)을 낸다.
 *
 * ⚠️ 파리티 보장 — getPdfInfo 와 동일해야 한다:
 *   - width/height = 첫 페이지 (pt → mm), `Math.round(pt * PT_TO_MM * 10) / 10` (소수1자리).
 *   - 0/NaN 가드: 첫 페이지 치수가 무효면 A4(210×297) 폴백.
 *   - 추출 실패/손상: `{ pageCount: 1, width: 210, height: 297 }` 폴백
 *     (getPdfInfo 의 load 실패 분기와 동일 — 콜러가 깨지지 않도록).
 *
 * 신규 ON 경로 전용(LIGHTWEIGHT_SYNTHESIS). 기존 getPdfInfo(OFF)는 불변.
 */
export async function getPdfInfoQpdf(filePath: string): Promise<{
  pageCount: number;
  width: number;
  height: number;
}> {
  // getPdfInfo 와 동일한 변환계수/폴백 치수(파리티).
  const PT_TO_MM = 0.352778;
  const A4_WIDTH_MM = 210;
  const A4_HEIGHT_MM = 297;

  try {
    const meta = await extractPdfMetadataQpdf(filePath);
    const pageCount = meta.pageCount;

    if (pageCount > 0 && meta.pages.length > 0) {
      const { widthPt, heightPt } = meta.pages[0];
      const widthMm = Math.round(widthPt * PT_TO_MM * 10) / 10;
      const heightMm = Math.round(heightPt * PT_TO_MM * 10) / 10;
      if (widthMm > 0 && heightMm > 0) {
        return { pageCount, width: widthMm, height: heightMm };
      }
    }

    // 치수를 못 얻었지만 pageCount 는 알 수 있는 경우 → getPdfInfo 와 동일하게 A4 폴백.
    return { pageCount: pageCount || 1, width: A4_WIDTH_MM, height: A4_HEIGHT_MM };
  } catch (error: any) {
    logger.warn(
      `getPdfInfoQpdf: failed to measure '${filePath}', falling back to A4 (${error?.message ?? error})`,
    );
    return { pageCount: 1, width: A4_WIDTH_MM, height: A4_HEIGHT_MM };
  }
}

async function extractPageSizesPdfinfo(
  filePath: string,
  pageCount: number,
): Promise<QpdfPageSize[] | null> {
  const PDFINFO_PATH = process.env.PDFINFO_PATH || 'pdfinfo';
  try {
    const last = pageCount > 0 ? pageCount : 1;
    const { stdout } = await execFileAsync(
      PDFINFO_PATH,
      ['-box', '-f', '1', '-l', String(last), filePath],
      { timeout: QPDF_TIMEOUT_MS, maxBuffer: QPDF_MAX_BUFFER },
    );
    // 'Page    N MediaBox:     0.00     0.00  1224.57   858.90' 형태 파싱.
    const re = /^Page\s+(\d+)\s+MediaBox:\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)/gm;
    const byIndex = new Map<number, QpdfPageSize>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null) {
      const idx = parseInt(m[1], 10);
      const llx = parseFloat(m[2]);
      const lly = parseFloat(m[3]);
      const urx = parseFloat(m[4]);
      const ury = parseFloat(m[5]);
      byIndex.set(idx, { widthPt: urx - llx, heightPt: ury - lly });
    }
    if (byIndex.size === 0) return null;
    const out: QpdfPageSize[] = [];
    for (let i = 1; i <= last; i++) {
      const s = byIndex.get(i);
      if (!s) return null; // 페이지 누락 시 폴백 무효(파리티 깨짐 방지).
      out.push(s);
    }
    return out;
  } catch (err: any) {
    logger.warn(`pdfinfo 폴백 실패: ${err?.message ?? err}`);
    return null;
  }
}
