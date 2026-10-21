/**
 * P2-d D13 (2026-10-21): 분리본 PDF 의 미참조 XObject 정리.
 *
 * jsPDF(편집기 완료 PDF)는 문서의 모든 이미지 XObject 를 **각 페이지** /Resources/XObject 에 올린다.
 * pdf-lib `copyPages` 는 페이지 리소스 사전을 그대로 복사하므로 sheet-map/duplex-split 의 2쪽 분리본에도
 * 원본 이미지 전부가 따라와 파일 크기가 원본과 같았다(26쪽 9.3MB → 13파일 × 9.26MB, 2026-10-20 실측).
 * qpdf `--pages` 경로(WORKER_LIGHTWEIGHT_SYNTHESIS ON)는 기본값(auto)으로 이미 미참조 리소스를 제거한다 —
 * 같은 파일 실측 9.26MB → 718KB. 이 유틸은 pdf-lib(OFF) 경로를 같은 결과로 맞춘다.
 *
 * 규칙(보수적 — 참조 여부가 불확실하면 남긴다):
 *  - 페이지 content stream(단일·배열)을 복호해 `/Name Do` 연산자의 Name 을 참조 집합으로 모은다.
 *  - 참조된 XObject 가 Form(/Subtype /Form)이고 **자기 /Resources 가 없으면** 그 내용의 `/Name Do` 도 페이지
 *    리소스에서 해석되므로 참조 집합에 더한다(재귀). 자기 /Resources 가 있는 Form 내부는 건드리지 않는다.
 *  - 어느 content stream 하나라도 복호할 수 없으면(지원하지 않는 필터 등) 그 페이지는 정리하지 않는다.
 *  - **공유 사전**: jsPDF 는 /Resources 와 /XObject 사전을 간접 객체 하나로 두고 모든 페이지가 참조한다(Pages 상속도 같은
 *    경우). 제자리에서 지우면 뒷면(이미지 미참조)이 앞면의 이미지까지 지우므로, 직접 사전이 아니면 페이지마다 복제해
 *    자기 사전으로 바꾼 뒤 정리한다(2026-10-21 로컬 실측: 복제 없이 set 파일 11KB 로 이미지 유실).
 *  - 사전에서 지운 항목의 객체는 compactPdfDocument 가 새 문서로 copyPages 할 때 도달 불가가 되어 저장에서 빠진다.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';

export interface PruneXObjectsResult {
  /** 검사한 페이지 수 */
  pages: number;
  /** 사전에서 제거한 XObject 항목 수(페이지 합) */
  removed: number;
  /** 남긴 XObject 항목 수(페이지 합) */
  kept: number;
  /** content stream 복호 실패 등으로 정리를 건너뛴 페이지 수 */
  skippedPages: number;
}

const XOBJECT = PDFName.of('XObject');
const SUBTYPE = PDFName.of('Subtype');
const RESOURCES = PDFName.of('Resources');
const FORM = PDFName.of('Form');

/** `/Name Do` — 공백(개행 포함) 뒤 Do 연산자. PDF 이름 토큰은 구분자·공백에서 끝난다. */
const DO_OPERATOR = /\/([^\s/[\]<>(){}%]+)\s+Do(?![A-Za-z0-9*'"])/g;

function streamBytes(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  const maybe = stream as unknown as { getUnencodedContents?: () => Uint8Array };
  if (typeof maybe.getUnencodedContents === 'function') return maybe.getUnencodedContents();
  return stream.getContents();
}

function namesReferencedIn(bytes: Uint8Array): Set<string> {
  const text = Buffer.from(bytes).toString('latin1');
  const names = new Set<string>();
  for (const m of text.matchAll(DO_OPERATOR)) names.add(m[1]);
  return names;
}

/** 페이지 /Contents(스트림 또는 스트림 배열)를 스트림 목록으로 — 참조는 context 로 푼다. */
function contentStreamsOf(doc: PDFDocument, contents: unknown): PDFStream[] | null {
  const resolved = doc.context.lookup(contents as never);
  if (resolved instanceof PDFStream) return [resolved];
  if (resolved instanceof PDFArray) {
    const out: PDFStream[] = [];
    for (const item of resolved.asArray()) {
      const s = doc.context.lookup(item);
      if (!(s instanceof PDFStream)) return null;
      out.push(s);
    }
    return out;
  }
  return resolved === undefined ? [] : null;
}

/**
 * 페이지 XObject 사전 기준 참조 집합 — content 의 `/Name Do` + (자기 Resources 없는) Form XObject 내부 참조(재귀).
 * 복호 실패 시 null(정리 건너뜀).
 */
function referencedNames(doc: PDFDocument, streams: PDFStream[], xobjects: PDFDict): Set<string> | null {
  const names = new Set<string>();
  try {
    for (const s of streams) for (const n of namesReferencedIn(streamBytes(s))) names.add(n);
  } catch {
    return null;
  }
  // Form XObject 내부 참조(페이지 리소스 상속) — 사이클 방어로 방문 집합을 둔다.
  const queue = [...names];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (visited.has(name)) continue;
    visited.add(name);
    const obj = doc.context.lookup(xobjects.get(PDFName.of(name)));
    if (!(obj instanceof PDFStream)) continue;
    const subtype = obj.dict.lookupMaybe(SUBTYPE, PDFName);
    if (subtype !== FORM) continue;
    if (obj.dict.has(RESOURCES)) continue; // 자기 리소스를 가진 Form — 페이지 사전과 무관
    try {
      for (const inner of namesReferencedIn(streamBytes(obj))) {
        if (!names.has(inner)) {
          names.add(inner);
          queue.push(inner);
        }
      }
    } catch {
      return null;
    }
  }
  return names;
}

/**
 * 페이지의 /Resources/XObject 사전을 **그 페이지만의 직접 사전**으로 돌려준다 — 간접 참조(다른 페이지와 공유·Pages 상속)면
 * 얕은 복제를 등록해 페이지에 바꿔 단다. 복제본의 값(이미지 스트림 참조)은 그대로라 copyPages 도달성은 변하지 않는다.
 */
function ownXObjectDict(doc: PDFDocument, page: PDFPage): PDFDict | undefined {
  let resources = page.node.Resources();
  if (!resources) return undefined;
  if (!(page.node.get(RESOURCES) instanceof PDFDict)) {
    resources = resources.clone(doc.context);
    page.node.set(RESOURCES, doc.context.register(resources));
  }
  const xobjects = resources.lookupMaybe(XOBJECT, PDFDict);
  if (!xobjects) return undefined;
  // /XObject 는 항상 복제해 직접 사전으로 단다 — 간접이면 다른 페이지와 공유되고, 직접이라도 위 Resources 얕은 복제가
  // 같은 사전 인스턴스를 가리킨다(jsPDF: 공유 /Resources 안의 직접 /XObject — 2026-10-21 실측, 복제 없이 set 11KB).
  const own = xobjects.clone(doc.context);
  resources.set(XOBJECT, own);
  return own;
}

/** 문서 전 페이지의 /Resources/XObject 에서 content 가 참조하지 않는 항목을 지운다(공유 사전은 페이지별 복제 뒤). */
export function pruneUnreferencedXObjects(doc: PDFDocument): PruneXObjectsResult {
  const result: PruneXObjectsResult = { pages: 0, removed: 0, kept: 0, skippedPages: 0 };
  for (const page of doc.getPages()) {
    result.pages += 1;
    const xobjects = ownXObjectDict(doc, page);
    if (!xobjects) continue;
    const streams = contentStreamsOf(doc, page.node.Contents());
    if (streams === null) {
      result.skippedPages += 1;
      result.kept += xobjects.keys().length;
      continue;
    }
    const referenced = referencedNames(doc, streams, xobjects);
    if (referenced === null) {
      result.skippedPages += 1;
      result.kept += xobjects.keys().length;
      continue;
    }
    for (const key of xobjects.keys()) {
      if (referenced.has(key.asString().slice(1))) {
        result.kept += 1;
      } else {
        xobjects.delete(key);
        result.removed += 1;
      }
    }
  }
  return result;
}

/**
 * 미참조 XObject 를 지운 뒤 새 문서로 페이지를 복사해 도달 불가 객체(지운 이미지·그 SMask 등)를 저장에서 뺀다.
 * pdf-lib `save()` 는 context 의 모든 객체를 쓰므로 사전에서 지우는 것만으로는 크기가 줄지 않는다 — copyPages 는
 * 페이지에서 도달 가능한 객체만 복사한다. /Rotate 등 페이지 사전 속성은 그대로 복사된다.
 */
export async function compactPdfDocument(
  doc: PDFDocument,
): Promise<{ doc: PDFDocument; pruned: PruneXObjectsResult }> {
  const pruned = pruneUnreferencedXObjects(doc);
  if (pruned.removed === 0) return { doc, pruned };
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, doc.getPageIndices());
  for (const p of pages) out.addPage(p);
  return { doc: out, pruned };
}
