import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { compactPdfDocument, pruneUnreferencedXObjects } from './pdf-prune-xobjects';

/**
 * P2-d D13 (2026-10-21) 회귀 잠금 — jsPDF 식 "모든 이미지를 매 페이지 /Resources/XObject 에 등재" 문서를
 * copyPages 로 2쪽 분리했을 때 content 가 참조하지 않는 이미지가 분리본에서 빠지는지.
 *
 * 픽스처는 pdf-lib 로 만든다: 이미지 N개(각 ~40KB 의 Image XObject 스트림), 페이지 M개가 전부 N개를 등재하되
 * content 는 페이지마다 1개만 `Do` 한다. 렌더링은 하지 않으므로 이미지 바이트는 의사 난수면 충분하다.
 */

const IMAGE_BYTES = 40 * 1024;

function pseudoRandomBytes(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = (x >>> 24) & 0xff; // LCG 상위 바이트(하위 비트는 주기가 짧아 flate 에 압축된다)
  }
  return out;
}

function addImageXObject(doc: PDFDocument, seed: number): PDFRef {
  const stream = doc.context.flateStream(pseudoRandomBytes(seed, IMAGE_BYTES), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: 100,
    Height: 100,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
  });
  return doc.context.register(stream);
}

interface FixtureOptions {
  images: number;
  pages: number;
  /** 페이지 i 의 content — 기본 `/Im{i % images} Do` */
  contentOf?: (pageIndex: number) => string;
  /** content stream 을 flate 압축(복호 경로 운동) */
  compressContent?: boolean;
  /** 페이지별 content 를 스트림 배열(/Contents [ ... ])로 */
  contentsArray?: boolean;
  /**
   * jsPDF 식 공유 — 'xobject': /XObject 사전 하나(간접)를 모든 페이지가 참조, 'resources': /Resources(간접) 공유 + 그 안의
   * /XObject 도 간접, 'resources-direct': /Resources(간접) 공유 + 그 안의 /XObject 는 직접 사전(jsPDF 실제 출력 형태)
   */
  shared?: 'xobject' | 'resources' | 'resources-direct';
}

/** 모든 페이지가 모든 이미지를 등재하는 jsPDF 식 문서를 만들어 저장→재로드(PDFRawStream 경로) */
async function buildJsPdfLikeDocument(opts: FixtureOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const refs = Array.from({ length: opts.images }, (_, i) => addImageXObject(doc, i + 1));
  const sharedXObjects = doc.context.obj(Object.fromEntries(refs.map((ref, i) => [`Im${i}`, ref])));
  const sharedXObjectsRef = doc.context.register(sharedXObjects);
  const sharedResourcesRef = doc.context.register(doc.context.obj({ XObject: sharedXObjectsRef }));
  const sharedResourcesDirectXObjectRef = doc.context.register(doc.context.obj({ XObject: sharedXObjects }));
  for (let p = 0; p < opts.pages; p++) {
    const page = doc.addPage([300, 300]);
    if (opts.shared === 'resources') page.node.set(PDFName.of('Resources'), sharedResourcesRef);
    else if (opts.shared === 'resources-direct') page.node.set(PDFName.of('Resources'), sharedResourcesDirectXObjectRef);
    else if (opts.shared === 'xobject') page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: sharedXObjectsRef }));
    else refs.forEach((ref, i) => page.node.setXObject(PDFName.of(`Im${i}`), ref));
    const text = opts.contentOf ? opts.contentOf(p) : `q 100 0 0 100 50 50 cm /Im${p % opts.images} Do Q`;
    const mk = (s: string) =>
      opts.compressContent ? doc.context.flateStream(Buffer.from(s)) : doc.context.stream(Buffer.from(s));
    if (opts.contentsArray) {
      const parts = text.split('\n').map((line) => doc.context.register(mk(line)));
      page.node.set(PDFName.of('Contents'), doc.context.obj(parts));
    } else {
      page.node.set(PDFName.of('Contents'), doc.context.register(mk(text)));
    }
  }
  return doc.save();
}

async function splitFirstTwoPages(bytes: Uint8Array): Promise<PDFDocument> {
  const src = await PDFDocument.load(bytes);
  const setDoc = await PDFDocument.create();
  const pages = await setDoc.copyPages(src, [0, 1]);
  pages.forEach((p) => setDoc.addPage(p));
  return setDoc;
}

function xobjectNames(doc: PDFDocument, pageIndex: number): string[] {
  const dict = doc.getPage(pageIndex).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  return dict ? dict.keys().map((k) => k.asString()) : [];
}

describe('pruneUnreferencedXObjects / compactPdfDocument (D13)', () => {
  it('copyPages 분리본: 각 페이지 content 가 Do 하는 이미지만 남기고 저장 크기가 줄어든다', async () => {
    const bytes = await buildJsPdfLikeDocument({ images: 6, pages: 4 });
    const bloated = await splitFirstTwoPages(bytes);
    const bloatedSize = (await bloated.save()).length;
    expect(xobjectNames(bloated, 0)).toHaveLength(6);

    const { doc, pruned } = await compactPdfDocument(bloated);
    expect(pruned).toEqual({ pages: 2, removed: 10, kept: 2, skippedPages: 0 });
    expect(doc.getPageCount()).toBe(2);
    expect(xobjectNames(doc, 0)).toEqual(['/Im0']);
    expect(xobjectNames(doc, 1)).toEqual(['/Im1']);

    const compactSize = (await doc.save()).length;
    // 6장 → 2장(페이지당 1장)이므로 1/3 근처. 사전·페이지 오버헤드 감안 45% 미만이면 도달 불가 객체가 빠진 것.
    expect(compactSize).toBeLessThan(bloatedSize * 0.45);
    expect(compactSize).toBeGreaterThan(IMAGE_BYTES);
  });

  it.each(['xobject', 'resources', 'resources-direct'] as const)(
    'jsPDF 식 공유 사전(%s 간접 공유): 뒷면이 앞면 이미지를 지우지 않도록 페이지별로 복제한 뒤 정리한다',
    async (shared) => {
      // 페이지 0 = /Im0, 페이지 1 = 참조 없음(뒷면) — 제자리 삭제였다면 페이지 1 처리에서 Im0 까지 사라진다(2026-10-21 실측 11KB).
      const bytes = await buildJsPdfLikeDocument({
        images: 3,
        pages: 2,
        shared,
        contentOf: (p) => (p === 0 ? 'q 100 0 0 100 50 50 cm /Im0 Do Q' : 'q Q'),
      });
      const setDoc = await splitFirstTwoPages(bytes);
      const { doc, pruned } = await compactPdfDocument(setDoc);
      expect(pruned).toEqual({ pages: 2, removed: 5, kept: 1, skippedPages: 0 });
      expect(xobjectNames(doc, 0)).toEqual(['/Im0']);
      expect(xobjectNames(doc, 1)).toEqual([]);
      const size = (await doc.save()).length;
      expect(size).toBeGreaterThan(IMAGE_BYTES); // Im0 스트림이 살아 있다
      expect(size).toBeLessThan(IMAGE_BYTES * 2); // Im1·Im2 는 빠졌다
    },
  );

  it('flate 압축 content·/Contents 배열도 복호해 참조를 찾는다', async () => {
    const bytes = await buildJsPdfLikeDocument({
      images: 3,
      pages: 2,
      compressContent: true,
      contentsArray: true,
      contentOf: (p) => `q 1 0 0 1 0 0 cm\n/Im${p} Do\nQ`,
    });
    const setDoc = await splitFirstTwoPages(bytes);
    const result = pruneUnreferencedXObjects(setDoc);
    expect(result).toEqual({ pages: 2, removed: 4, kept: 2, skippedPages: 0 });
    expect(xobjectNames(setDoc, 0)).toEqual(['/Im0']);
    expect(xobjectNames(setDoc, 1)).toEqual(['/Im1']);
  });

  it('자기 Resources 가 없는 Form XObject 안의 Do 참조도 유지한다(페이지 리소스 상속)', async () => {
    const doc = await PDFDocument.create();
    const im = [addImageXObject(doc, 11), addImageXObject(doc, 12), addImageXObject(doc, 13)];
    // Fm0: 자기 Resources 없음 → 내부 /Im2 Do 는 페이지 사전에서 해석
    const form = doc.context.stream(Buffer.from('q 50 0 0 50 0 0 cm /Im2 Do Q'), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 100, 100],
    });
    const formRef = doc.context.register(form);
    const page = doc.addPage([200, 200]);
    im.forEach((ref, i) => page.node.setXObject(PDFName.of(`Im${i}`), ref));
    page.node.setXObject(PDFName.of('Fm0'), formRef);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(Buffer.from('q /Fm0 Do Q'))));
    doc.addPage([200, 200]);
    const setDoc = await splitFirstTwoPages(await doc.save());

    const result = pruneUnreferencedXObjects(setDoc);
    expect(result.removed).toBe(2); // Im0, Im1
    expect(xobjectNames(setDoc, 0).sort()).toEqual(['/Fm0', '/Im2']);
  });

  it('복호할 수 없는 content stream 이 있는 페이지는 건너뛴다(보수적 — 전부 유지)', async () => {
    const doc = await PDFDocument.create();
    const im = [addImageXObject(doc, 21), addImageXObject(doc, 22)];
    const page = doc.addPage([200, 200]);
    im.forEach((ref, i) => page.node.setXObject(PDFName.of(`Im${i}`), ref));
    const weird = doc.context.stream(Buffer.from('q /Im0 Do Q'), { Filter: 'JBIG2Decode' });
    page.node.set(PDFName.of('Contents'), doc.context.register(weird));
    doc.addPage([200, 200]);
    const setDoc = await splitFirstTwoPages(await doc.save());

    const result = pruneUnreferencedXObjects(setDoc);
    expect(result.skippedPages).toBe(1);
    expect(result.removed).toBe(0);
    expect(xobjectNames(setDoc, 0).sort()).toEqual(['/Im0', '/Im1']);
    // 제거가 0이면 compact 는 같은 문서를 돌려준다(복사 비용 없음)
    const { doc: same, pruned } = await compactPdfDocument(setDoc);
    expect(same).toBe(setDoc);
    expect(pruned.removed).toBe(0);
  });

  it('회전(/Rotate)·페이지 수는 compact 뒤에도 보존된다', async () => {
    const bytes = await buildJsPdfLikeDocument({ images: 2, pages: 2 });
    const setDoc = await splitFirstTwoPages(bytes);
    setDoc.getPage(1).setRotation({ type: 'degrees', angle: 180 } as never);
    const { doc } = await compactPdfDocument(setDoc);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getRotation().angle).toBe(180);
    expect(doc.getPage(0).node.Contents()).not.toBeInstanceOf(PDFArray);
  });
});
