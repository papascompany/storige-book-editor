import { execFile } from 'child_process';
import { promisify } from 'util';
import { Logger } from '@nestjs/common';
import {
  AnnotationDetectionResult,
  PageGeometryResult,
} from '../dto/validation-result.dto';

const execFileAsync = promisify(execFile);
const logger = new Logger('AnnotationsQpdf');

/**
 * R4a (2026-08-11) — 주석(Annotation)/양식(AcroForm) 검출.
 *
 * 고객이 교정 코멘트(스티키노트·하이라이트·자유텍스트)나 폼 필드가 남은 PDF 를
 * 제출하는 사고 대응. 기반 ISO 15930(PDF/X)은 인쇄 영역 내 주석·폼을 금지한다.
 *
 * 도구: qpdf --json (R2 감사에서 채택 판정한 미활용 기능). 구현 규약은
 * pdf-metadata-qpdf.ts 와 동형(execFile+env 경로+타임아웃+경고 code 3 회수),
 * 실패는 null 흡수(R2/R3 규약 — 검출 실패가 검증을 방해하지 않는다).
 *
 * 분류:
 *  - Link/Popup 서브타입은 집계에서 제외 — Link 는 인쇄 외형(appearance)이 없어
 *    사무 문서(URL 자동링크)에서 흔하고, Popup 은 Text 주석의 부속 창이라
 *    본체(Text)만 세면 된다. 이들까지 세면 상시 오탐이 난다.
 *  - AcroForm 은 카탈로그 /AcroForm 의 /Fields 비어있지 않음 기준(해석 불능 시
 *    존재만으로 보수 판정).
 */

const QPDF_PATH = process.env.QPDF_PATH || 'qpdf';
const QPDF_TIMEOUT_MS = Number(process.env.QPDF_TIMEOUT_MS || 120000);
const QPDF_MAX_BUFFER = 256 * 1024 * 1024; // 256MB — pdf-metadata-qpdf 와 동일 근거

/** 인쇄 외형이 없거나 부속 객체라 경고 대상에서 제외하는 주석 서브타입 */
const IGNORED_SUBTYPES = new Set(['Link', 'Popup']);

/** qpdf --json v2 객체맵 unwrap — pdf-metadata-qpdf.unwrapObject 와 동일 규약(사본).
 *  (원본은 모듈 private — 파리티 동결 모듈 무접촉 원칙으로 수출 대신 복제, 로직 동일 유지) */
function unwrapObject(objmap: Record<string, any>, ref: string): any | null {
  const key = ref.startsWith('obj:') ? ref : `obj:${ref}`;
  const entry = objmap[key];
  if (entry === undefined || entry === null) return null;
  if (typeof entry === 'object' && 'value' in entry) return entry.value;
  return entry;
}

const INDIRECT_REF_RE = /^\d+ \d+ R$/;

/** 간접참조 문자열이면 unwrap, 아니면 원값 반환 */
function resolveMaybeRef(objmap: Record<string, any>, v: any): any {
  if (typeof v === 'string' && INDIRECT_REF_RE.test(v)) {
    return unwrapObject(objmap, v);
  }
  return v;
}

/** '/Widget' | 'Widget' → 'Widget' 정규화 */
function normalizeName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.startsWith('/') ? v.slice(1) : v;
}

/**
 * qpdf --json 문서 객체에서 주석/폼을 집계한다(순수 — 테스트 대상).
 * doc = { pages: [{object: 'N N R'}...], qpdf: [header, objmap] }
 */
export function parseAnnotationsFromQpdfJson(doc: any): AnnotationDetectionResult {
  const pageList: any[] = Array.isArray(doc?.pages) ? doc.pages : [];
  const objmap: Record<string, any> = Array.isArray(doc?.qpdf)
    ? doc.qpdf[1] ?? {}
    : {};

  let annotationCount = 0;
  const pagesWithAnnotations: number[] = [];
  const subtypeCounts: Record<string, number> = {};

  pageList.forEach((p, idx) => {
    const pageDict = unwrapObject(objmap, p?.object ?? '');
    if (!pageDict) return;

    const annotsRaw = resolveMaybeRef(objmap, pageDict['/Annots']);
    if (!Array.isArray(annotsRaw) || annotsRaw.length === 0) return;

    let pageCount = 0;
    for (const a of annotsRaw) {
      const annotDict = resolveMaybeRef(objmap, a);
      // 서브타입 해석 불능 주석은 보수적으로 집계(존재 자체가 비정상 제출 신호).
      const subtype = normalizeName(annotDict?.['/Subtype']) || 'Unknown';
      if (IGNORED_SUBTYPES.has(subtype)) continue;
      pageCount += 1;
      subtypeCounts[subtype] = (subtypeCounts[subtype] ?? 0) + 1;
    }
    if (pageCount > 0) {
      annotationCount += pageCount;
      pagesWithAnnotations.push(idx + 1);
    }
  });

  // AcroForm: trailer → /Root → /AcroForm(/Fields 비어있지 않음).
  let hasAcroForm = false;
  const trailer = objmap['trailer'];
  const trailerDict =
    trailer && typeof trailer === 'object' && 'value' in trailer
      ? (trailer as any).value
      : trailer;
  const rootRef = trailerDict?.['/Root'];
  const root = typeof rootRef === 'string' ? unwrapObject(objmap, rootRef) : rootRef;
  const acroRaw = root?.['/AcroForm'];
  if (acroRaw !== undefined) {
    const acro = resolveMaybeRef(objmap, acroRaw);
    const fields = resolveMaybeRef(objmap, acro?.['/Fields']);
    // /Fields 해석 성공 시 비어있지 않을 때만, 해석 불능이면 존재만으로 보수 판정.
    hasAcroForm = Array.isArray(fields) ? fields.length > 0 : true;
  }

  return { annotationCount, pagesWithAnnotations, subtypeCounts, hasAcroForm };
}

/**
 * qpdf --json(pages+objmap) 문서 객체 공용 취득 — 실패 시 null.
 * (annotations·geometry 검출이 공유. 경고 code 3 stdout 회수는 pdf-metadata-qpdf 규약)
 */
export async function fetchQpdfJson(filePath: string): Promise<any | null> {
  try {
    let stdout: string;
    try {
      const res = await execFileAsync(
        QPDF_PATH,
        ['--json', '--json-key=pages', '--json-key=qpdf', '--', filePath],
        { timeout: QPDF_TIMEOUT_MS, maxBuffer: QPDF_MAX_BUFFER },
      );
      stdout = res.stdout;
    } catch (e: any) {
      // 경고만(code 3)이고 stdout 이 온전하면 회수 — pdf-metadata-qpdf 와 동일 규약.
      if (e?.code === 3 && typeof e.stdout === 'string' && e.stdout.length > 0) {
        stdout = e.stdout;
      } else {
        throw e;
      }
    }
    return JSON.parse(stdout);
  } catch (err: any) {
    logger.warn(
      `qpdf --json fetch failed for '${filePath}' (${err?.code ?? err?.message})`,
    );
    return null;
  }
}

/**
 * qpdf --json 으로 주석/폼을 검출한다. 실패 시 null(경고 스킵 — 검증 무영향).
 */
export async function detectAnnotationsQpdf(
  filePath: string,
): Promise<AnnotationDetectionResult | null> {
  const doc = await fetchQpdfJson(filePath);
  if (!doc) return null;
  const result = parseAnnotationsFromQpdfJson(doc);
  if (result.annotationCount > 0 || result.hasAcroForm) {
    logger.debug(
      `annotations: ${result.annotationCount} (pages ${result.pagesWithAnnotations.join(',')}), acroForm=${result.hasAcroForm}`,
    );
  }
  return result;
}

// ============================================================
// R4b (2026-08-11): 페이지 기하 이상 검출 — GWG R0002~R0006 슬라이스
// ============================================================

/**
 * 페이지 기하 이상을 집계한다(순수 — 테스트 대상).
 *
 * - /UserUnit ≠ 1 : 페이지 스케일 왜곡(GWG error 급) — 재증류로도 안 고쳐질 수 있어 고지.
 * - /Rotate ≠ 0(mod 360) : 뷰어 회전 의존 — GS 재증류가 굽기(bake) 처리하므로 정보성.
 * - 페이지 명시 /CropBox ≠ 상속 /MediaBox : 뷰어 표시영역과 실판형 불일치 — 재증류가
 *   정규화하므로 정보성. (CropBox 는 상속 가능하나 v1 은 페이지 명시 선언만 본다 —
 *   부모 상속 CropBox 는 드물고, 오탐 방지가 우선)
 */
export function parsePageGeometryFromQpdfJson(doc: any): PageGeometryResult {
  const pageList: any[] = Array.isArray(doc?.pages) ? doc.pages : [];
  const objmap: Record<string, any> = Array.isArray(doc?.qpdf)
    ? doc.qpdf[1] ?? {}
    : {};

  const userUnitPages: number[] = [];
  const rotatedPages: number[] = [];
  const cropBoxMismatchPages: number[] = [];
  const TOL_PT = 0.5;

  pageList.forEach((p, idx) => {
    const pageDict = unwrapObject(objmap, p?.object ?? '');
    if (!pageDict) return;
    const pageNo = idx + 1;

    const userUnit = resolveMaybeRef(objmap, pageDict['/UserUnit']);
    if (typeof userUnit === 'number' && Math.abs(userUnit - 1) > 1e-9) {
      userUnitPages.push(pageNo);
    }

    const rotate = resolveMaybeRef(objmap, pageDict['/Rotate']);
    if (typeof rotate === 'number' && ((rotate % 360) + 360) % 360 !== 0) {
      rotatedPages.push(pageNo);
    }

    // 페이지 명시 CropBox vs 상속 MediaBox (둘 다 해석 가능할 때만 — 오탐 방지)
    const cropRaw = pageDict['/CropBox'];
    if (cropRaw !== undefined) {
      const crop = resolveMaybeRef(objmap, cropRaw);
      const media = resolveInheritedMediaBoxLocal(objmap, pageDict, p?.object ?? '');
      if (
        Array.isArray(crop) &&
        crop.length === 4 &&
        crop.every((v: any) => typeof v === 'number') &&
        media
      ) {
        const mismatch = crop.some(
          (v: number, i: number) => Math.abs(v - media[i]) > TOL_PT,
        );
        if (mismatch) cropBoxMismatchPages.push(pageNo);
      }
    }
  });

  return { userUnitPages, rotatedPages, cropBoxMismatchPages };
}

/** MediaBox 상속 해석 — pdf-metadata-qpdf.resolveInheritedMediaBox 와 동일 규약(사본) */
function resolveInheritedMediaBoxLocal(
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
      const nums = mb.map((n: any) => (typeof n === 'number' ? n : Number(n)));
      if (nums.some((v: number) => !Number.isFinite(v))) return null;
      return nums;
    }
    const parentRef: string | undefined = node['/Parent'];
    if (!parentRef || typeof parentRef !== 'string') break;
    if (nodeRef) seen.add(nodeRef);
    if (seen.has(parentRef)) break;
    node = unwrapObject(objmap, parentRef);
    nodeRef = parentRef;
  }
  return null;
}

/** 페이지 기하 이상 검출 — 실패 시 null(경고 스킵). */
export async function detectPageGeometryQpdf(
  filePath: string,
): Promise<PageGeometryResult | null> {
  const doc = await fetchQpdfJson(filePath);
  if (!doc) return null;
  return parsePageGeometryFromQpdfJson(doc);
}
