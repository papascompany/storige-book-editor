import {
  parsePdffontsOutput,
  parsePdfimagesListOutput,
} from './poppler-preflight';

/**
 * R2 프리플라이트 정밀화 — poppler 표 출력 파서 회귀 잠금.
 *
 * 픽스처는 poppler 25.x 실출력 형식 그대로(열 정렬 공백 포함). 파서는 우측 고정
 * 열 기반이라 열 폭 변동에 견고해야 하며, 여기서 그 계약을 잠근다.
 */

describe('parsePdffontsOutput', () => {
  const HEADER =
    'name                                 type              encoding         emb sub uni object ID\n' +
    '------------------------------------ ----------------- ---------------- --- --- --- ---------\n';

  it('임베드·서브셋·미임베드를 구분하고 공백 포함 타입명을 정확히 파싱한다', () => {
    const out =
      HEADER +
      'ABCDEF+NanumGothic                   CID TrueType      Identity-H       yes yes yes     12  0\n' +
      'Helvetica                            Type 1            WinAnsi          no  no  no      24  0\n' +
      'GHIJKL+NotoSansKR-Regular            CID Type 0C (OT)  Identity-H       yes yes yes     31  0\n';

    const r = parsePdffontsOutput(out);

    expect(r.fontCount).toBe(3);
    expect(r.fonts[0]).toEqual({
      name: 'ABCDEF+NanumGothic',
      type: 'CID TrueType',
      embedded: true,
      subset: true,
      encoding: 'Identity-H',
    });
    expect(r.fonts[1]).toEqual({
      name: 'Helvetica',
      type: 'Type 1',
      embedded: false,
      subset: false,
      encoding: 'WinAnsi',
    });
    expect(r.fonts[2].type).toBe('CID Type 0C (OT)');
    expect(r.hasUnembeddedFonts).toBe(true);
    expect(r.unembeddedFonts).toEqual(['Helvetica']);
    expect(r.allFontsEmbedded).toBe(false);
  });

  it('전량 임베드면 allFontsEmbedded=true', () => {
    const out =
      HEADER +
      'ABCDEF+Pretendard-Bold               TrueType          WinAnsi          yes yes yes      8  0\n';
    const r = parsePdffontsOutput(out);
    expect(r.hasUnembeddedFonts).toBe(false);
    expect(r.allFontsEmbedded).toBe(true);
  });

  it('Type 3(자체완결 글리프)은 emb=no 여도 미임베드 경고 대상에서 제외한다', () => {
    const out =
      HEADER +
      '[none]                               Type 3            Custom           no  no  no      15  0\n';
    const r = parsePdffontsOutput(out);
    expect(r.fontCount).toBe(1);
    expect(r.fonts[0].name).toBe('[none]');
    expect(r.hasUnembeddedFonts).toBe(false);
  });

  it('폰트 0건(벡터 전용 PDF)도 기존 검출과 동일 시맨틱: allFontsEmbedded=true', () => {
    const r = parsePdffontsOutput(HEADER);
    expect(r.fontCount).toBe(0);
    expect(r.hasUnembeddedFonts).toBe(false);
    // 파리티: ghostscript.ts detectFonts 는 allFontsEmbedded = !hasUnembeddedFonts.
    expect(r.allFontsEmbedded).toBe(true);
  });

  it('중복 미임베드 폰트명은 1회만 집계하고, 형식 불일치 행은 건너뛴다', () => {
    const out =
      HEADER +
      'Helvetica                            Type 1            WinAnsi          no  no  no      24  0\n' +
      'Helvetica                            Type 1            WinAnsi          no  no  no      44  0\n' +
      'poppler: some warning line without table shape\n';
    const r = parsePdffontsOutput(out);
    expect(r.fontCount).toBe(2);
    expect(r.unembeddedFonts).toEqual(['Helvetica']);
  });
});

describe('parsePdfimagesListOutput', () => {
  const HEADER =
    'page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n' +
    '--------------------------------------------------------------------------------------------\n';

  it('실배치 DPI(x/y-ppi)로 저해상도를 판정한다 — 페이지 전체 가정이 아니라', () => {
    const out =
      HEADER +
      '   1     0 image    1250  1667  rgb     3   8  jpeg   no        10  0   350   350  156K 2.6%\n' +
      '   2     1 image     600   400  rgb     3   8  jpeg   no        12  0    72    96   80K 5.0%\n';

    const r = parsePdfimagesListOutput(out, 150);

    expect(r.imageCount).toBe(2);
    expect(r.images[0].minEffectiveDpi).toBe(350);
    expect(r.images[1]).toMatchObject({
      pixelWidth: 600,
      pixelHeight: 400,
      effectiveDpiX: 72,
      effectiveDpiY: 96,
      minEffectiveDpi: 72,
    });
    // 실배치 크기 = 픽셀/실배치DPI: 600px @72ppi = 211.7mm, 400px @96ppi = 105.8mm
    expect(r.images[1].displayWidthMm).toBeCloseTo(211.7, 1);
    expect(r.images[1].displayHeightMm).toBeCloseTo(105.8, 1);
    expect(r.hasLowResolution).toBe(true);
    expect(r.lowResImages).toHaveLength(1);
    expect(r.minResolution).toBe(72);
    expect(r.avgResolution).toBe(211); // (350+72)/2
  });

  it('smask/stencil 보조 채널은 해상도 집계에서 제외한다', () => {
    const out =
      HEADER +
      '   1     0 image    1250  1667  rgb     3   8  jpeg   no        10  0   300   300  156K 2.6%\n' +
      '   1     1 smask    1250  1667  gray    1   8  image  no        10  0    60    60   40K 1.9%\n' +
      '   1     2 stencil    64    64  -       1   1  image  no        18  0    30    30    1K 3.0%\n';
    const r = parsePdfimagesListOutput(out, 150);
    expect(r.imageCount).toBe(1);
    expect(r.hasLowResolution).toBe(false);
  });

  it("판정 불능 ppi('inf'/0)와 인라인 이미지 변형 행에 견고하다", () => {
    const out =
      HEADER +
      '   1     0 image     100   100  rgb     3   8  jpeg   no        10  0   inf   inf    5K 9.0%\n' +
      '   1     1 image     800   600  rgb     3   8  image  no   [inline]      200   200   90K 4.0%\n';
    const r = parsePdfimagesListOutput(out, 150);
    // 'inf' 행은 제외, 인라인 행(중간 열 개수 변형)은 앞5+뒤4 열 기반이라 정상 파싱.
    expect(r.imageCount).toBe(1);
    expect(r.images[0].minEffectiveDpi).toBe(200);
  });

  it('이미지 0건이면 기존 검출과 동일한 영값 형태를 낸다', () => {
    const r = parsePdfimagesListOutput(HEADER, 150);
    expect(r).toEqual({
      imageCount: 0,
      hasLowResolution: false,
      minResolution: 0,
      avgResolution: 0,
      lowResImages: [],
      images: [],
    });
  });
});
