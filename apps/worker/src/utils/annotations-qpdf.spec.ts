import {
  parseAnnotationsFromQpdfJson,
  parsePageGeometryFromQpdfJson,
} from './annotations-qpdf';

/**
 * R4a 주석/양식 검출 파서 회귀 잠금.
 * 픽스처는 qpdf --json v2 형태(pages + qpdf[1] 객체맵, {value:{...}} 래퍼).
 */

const doc = (pages: any[], objmap: Record<string, any>) => ({
  pages,
  qpdf: [{ jsonversion: 2 }, objmap],
});

describe('parseAnnotationsFromQpdfJson', () => {
  it('교정 주석을 페이지별로 집계하고 Link/Popup 은 제외한다', () => {
    const d = doc(
      [{ object: '1 0 R' }, { object: '2 0 R' }],
      {
        'obj:1 0 R': {
          value: { '/Annots': ['10 0 R', '11 0 R', '12 0 R'] },
        },
        'obj:2 0 R': { value: {} },
        'obj:10 0 R': { value: { '/Subtype': '/FreeText' } },
        'obj:11 0 R': { value: { '/Subtype': '/Link' } }, // 제외
        'obj:12 0 R': { value: { '/Subtype': '/Highlight' } },
        trailer: { value: { '/Root': '5 0 R' } },
        'obj:5 0 R': { value: {} },
      },
    );

    const r = parseAnnotationsFromQpdfJson(d);
    expect(r.annotationCount).toBe(2);
    expect(r.pagesWithAnnotations).toEqual([1]);
    expect(r.subtypeCounts).toEqual({ FreeText: 1, Highlight: 1 });
    expect(r.hasAcroForm).toBe(false);
  });

  it('Annots 배열 자체가 간접참조여도 해석한다', () => {
    const d = doc(
      [{ object: '1 0 R' }],
      {
        'obj:1 0 R': { value: { '/Annots': '20 0 R' } },
        'obj:20 0 R': { value: ['21 0 R'] },
        'obj:21 0 R': { value: { '/Subtype': '/Ink' } },
        trailer: { value: { '/Root': '5 0 R' } },
        'obj:5 0 R': { value: {} },
      },
    );
    const r = parseAnnotationsFromQpdfJson(d);
    expect(r.annotationCount).toBe(1);
    expect(r.subtypeCounts).toEqual({ Ink: 1 });
  });

  it('AcroForm: Fields 비어있지 않을 때만 true, 해석 불능이면 보수적으로 true', () => {
    const base = {
      'obj:1 0 R': { value: {} },
      trailer: { value: { '/Root': '5 0 R' } },
    };
    // Fields 있음
    let r = parseAnnotationsFromQpdfJson(
      doc([{ object: '1 0 R' }], {
        ...base,
        'obj:5 0 R': { value: { '/AcroForm': { '/Fields': ['30 0 R'] } } },
      }),
    );
    expect(r.hasAcroForm).toBe(true);
    // Fields 빈 배열 → false
    r = parseAnnotationsFromQpdfJson(
      doc([{ object: '1 0 R' }], {
        ...base,
        'obj:5 0 R': { value: { '/AcroForm': { '/Fields': [] } } },
      }),
    );
    expect(r.hasAcroForm).toBe(false);
    // AcroForm 이 미해석 간접참조 → 보수적 true
    r = parseAnnotationsFromQpdfJson(
      doc([{ object: '1 0 R' }], {
        ...base,
        'obj:5 0 R': { value: { '/AcroForm': '99 0 R' } },
      }),
    );
    expect(r.hasAcroForm).toBe(true);
  });

  it('서브타입 미해석 주석은 Unknown 으로 보수 집계한다', () => {
    const d = doc(
      [{ object: '1 0 R' }],
      {
        'obj:1 0 R': { value: { '/Annots': ['40 0 R'] } },
        // obj:40 0 R 부재 → annotDict null → Unknown
        trailer: { value: { '/Root': '5 0 R' } },
        'obj:5 0 R': { value: {} },
      },
    );
    const r = parseAnnotationsFromQpdfJson(d);
    expect(r.annotationCount).toBe(1);
    expect(r.subtypeCounts).toEqual({ Unknown: 1 });
  });

  it('주석/폼이 전혀 없으면 전부 영값', () => {
    const r = parseAnnotationsFromQpdfJson(
      doc([{ object: '1 0 R' }], {
        'obj:1 0 R': { value: {} },
        trailer: { value: { '/Root': '5 0 R' } },
        'obj:5 0 R': { value: {} },
      }),
    );
    expect(r).toEqual({
      annotationCount: 0,
      pagesWithAnnotations: [],
      subtypeCounts: {},
      hasAcroForm: false,
    });
  });
});

describe('parsePageGeometryFromQpdfJson (R4b)', () => {
  it('UserUnit≠1·Rotate≠0·명시 CropBox≠상속 MediaBox 를 페이지별로 집계한다', () => {
    const d = doc(
      [{ object: '1 0 R' }, { object: '2 0 R' }, { object: '3 0 R' }],
      {
        'obj:1 0 R': {
          value: { '/UserUnit': 2, '/MediaBox': [0, 0, 595, 842] },
        },
        'obj:2 0 R': {
          value: { '/Rotate': 90, '/MediaBox': [0, 0, 595, 842] },
        },
        'obj:3 0 R': {
          value: {
            '/MediaBox': [0, 0, 595, 842],
            '/CropBox': [10, 10, 585, 832],
          },
        },
        trailer: { value: { '/Root': '5 0 R' } },
        'obj:5 0 R': { value: {} },
      },
    );
    const r = parsePageGeometryFromQpdfJson(d);
    expect(r.userUnitPages).toEqual([1]);
    expect(r.rotatedPages).toEqual([2]);
    expect(r.cropBoxMismatchPages).toEqual([3]);
  });

  it('정상 문서(Rotate 0/360·CropBox=MediaBox·UserUnit 1)는 전부 빈 배열', () => {
    const d = doc(
      [{ object: '1 0 R' }],
      {
        'obj:1 0 R': {
          value: {
            '/UserUnit': 1,
            '/Rotate': 360,
            '/MediaBox': [0, 0, 595, 842],
            '/CropBox': [0, 0, 595, 842.3], // 0.5pt 허용치 이내
          },
        },
        trailer: { value: { '/Root': '5 0 R' } },
        'obj:5 0 R': { value: {} },
      },
    );
    const r = parsePageGeometryFromQpdfJson(d);
    expect(r).toEqual({ userUnitPages: [], rotatedPages: [], cropBoxMismatchPages: [] });
  });

  it('MediaBox 는 부모 상속으로 해석해 CropBox 와 대조한다', () => {
    const d = doc(
      [{ object: '1 0 R' }],
      {
        'obj:1 0 R': {
          value: { '/Parent': '9 0 R', '/CropBox': [0, 0, 300, 300] },
        },
        'obj:9 0 R': { value: { '/MediaBox': [0, 0, 595, 842] } },
        trailer: { value: { '/Root': '5 0 R' } },
        'obj:5 0 R': { value: {} },
      },
    );
    expect(parsePageGeometryFromQpdfJson(d).cropBoxMismatchPages).toEqual([1]);
  });
});
