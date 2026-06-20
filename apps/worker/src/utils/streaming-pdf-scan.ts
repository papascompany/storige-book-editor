/**
 * 스트리밍 PDF 검출 스캐너 (트랙 B-(d) — 2GB 상수메모리 검증 ON 경로 전용)
 *
 * 배경:
 *   기존 검출기 5종(detectSpotColors / detectTransparencyAndOverprint /
 *   detectImageResolutionFromPdf / detectFonts / detectCmykStructure)은 전부
 *   `new TextDecoder('latin1').decode(전체바이트)` 로 PDF 전체를 한 번에 메모리에
 *   올린 뒤 전역 regex 를 돌린다. 2GB 파일에서는 OOM 이 난다.
 *
 *   이 모듈은 동일한 regex·필터·결과 shape 를 유지한 채, 파일을
 *   **8MB 청크 + 256KB 오버랩** 으로 순차 스캔하여 **상수 메모리**로 동일한 결과를
 *   누적 반환한다. (기존 OFF 경로는 절대 수정하지 않으며, 이 파일은 신규 ON 경로 전용.)
 *
 * 동일성(파리티) 보장 전략:
 *   - 정규식/필터/디코딩(latin1)/DPI 공식은 원본을 그대로 복사한다(추측 금지).
 *   - 청크 경계에 걸쳐 잘린 토큰을 누락하지 않도록, 직전 청크 끝 256KB 를 carry 로
 *     다음 청크 앞에 붙여 디코드한 뒤 regex 를 적용한다(오버랩).
 *   - 오버랩 구간 재매칭으로 인한 이중 카운트는 자료구조로 흡수한다:
 *       · 별색 이름 / 폰트 이름 / cmyk 시그니처 → Set/배열 dedupe (원본과 동일한 dedupe 규칙)
 *       · 투명도/오버프린트 → boolean OR (멱등)
 *       · 이미지 → 원본 detectImageResolutionFromPdf 와 동일하게 `${W}x${H}` 키 전역 dedupe
 *   - 각 검출기는 자체 try/catch 로 실패 시 원본과 동일한 안전기본값을 반환한다.
 *
 * 이미지 해상도 주의:
 *   원본 detectImageResolutionFromPdf 는 MediaBox 를 PDF 에서 직접 추출했지만,
 *   여기서는 호출부가 qpdf 메타로 구한 페이지 치수(opts.pageWidthMm/Height)를 주입받아
 *   사용한다. 픽셀 Width/Height regex, `<50` skip 필터, aspect-fit 표시크기 추정,
 *   effective DPI 공식, 결과 집계(min/avg)는 원본과 동일하게 유지한다.
 */
import { createReadStream } from 'fs';
import { Logger } from '@nestjs/common';
import {
  SpotColorResult,
  TransparencyResult,
  ImageResolutionResult,
  ImageInfo,
  FontDetectionResult,
} from '../dto/validation-result.dto';
import { VALIDATION_CONFIG } from '../config/validation.config';

/** 이미지 DPI 계산용 페이지 치수 폴백 — OFF detectImageResolutionFromPdf 와 동일한 A4 기본값(pt). */
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
/**
 * 이미지 해상도용 페이지 MediaBox 정규식 — OFF detectImageResolutionFromPdf 와 '글자단위 동일'.
 * (페이지 검증용 치수는 qpdf 메타를 쓰지만, 이미지 DPI 는 OFF 가 '평문 첫 MediaBox/없으면 A4'
 *  를 쓰므로 파리티 위해 ON 도 동일 소스를 사용한다. 회전/CropBox 미반영도 OFF 와 동일.)
 */
const MEDIABOX_RE =
  /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/;

const logger = new Logger('StreamingPdfScan');

/** 청크 크기 (8MB) */
const CHUNK_SIZE = 8 * 1024 * 1024;
/** 인접 청크 기본 오버랩 (256KB) — 짧은 토큰(/Name·/ca·/DeviceCMYK 등) 경계 누락 방지 */
const OVERLAP_SIZE = 256 * 1024;
/**
 * carry 상한 (8MB). 경계 부근에 '열린' 토큰(<<… 딕셔너리, /Separation·/DeviceN 긴 이름)이
 * 기본 오버랩(256KB)보다 더 앞에서 시작하면 그 시작점부터 통째로 이월해 폰트/이미지
 * 딕셔너리·별색 이름이 8MB 청크 경계에서 잘려 '완전 누락'되는 것을 막는다(파리티 보강).
 * 이 상한을 넘는 단일 토큰(>8MB, 비현실적/악성)만 누락 가능 — 메모리는 상수로 bound.
 */
const MAX_CARRY = 8 * 1024 * 1024;
/**
 * 원본 검출기 5종과 '동일한' WHATWG 'latin1'(= windows-1252) 디코더.
 * ⚠️ Buffer.toString('latin1')(= 진짜 ISO-8859-1)과 바이트 0x80–0x9F 에서 매핑이 달라
 *    별색/폰트 이름의 고바이트 문자열이 갈린다 → 반드시 TextDecoder 를 써야 파리티 일치.
 * windows-1252 는 무상태 단일바이트(1 byte = 1 char)라 청크별 decode 가 전체 decode 와
 * 동일하고, carry 의 문자열-길이 == 바이트-길이 정합도 유지된다.
 */
const LATIN1 = new TextDecoder('latin1');

/** 1차 구조적 CMYK 감지 결과 (pdf-validator.service 의 private 결과 shape 와 동일) */
export interface CmykSignatureResult {
  hasCmykSignature: boolean;
  signatures: string[];
  suspectedCmyk: boolean;
}

/** scanPdfStreaming 통합 결과 */
export interface StreamingScanResult {
  spot: SpotColorResult;
  transparency: TransparencyResult;
  fonts: FontDetectionResult;
  resolution: ImageResolutionResult;
  cmyk: CmykSignatureResult;
}

export interface StreamingScanOptions {
  /** 저해상도 판정 기준 DPI */
  minDpi: number;
}

// ============================================================
// 원본 헬퍼 복사 (ghostscript.ts / pdf-validator.service.ts 와 동일)
// ============================================================

/** 별색/폰트 이름 디코딩 — PDF #XX 16진 인코딩 복원 (원본 동일) */
function decodeName(encoded: string): string {
  return encoded.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/** 시스템/프로세스 컬러 여부 (원본 isSystemColor 동일) */
function isSystemColor(colorName: string): boolean {
  const systemColors = [
    'Cyan',
    'Magenta',
    'Yellow',
    'Black',
    'None',
    'All',
    'Registration',
    'Process Cyan',
    'Process Magenta',
    'Process Yellow',
    'Process Black',
  ];
  return systemColors.some(
    (sys) => colorName.toLowerCase() === sys.toLowerCase(),
  );
}

/** 폰트 타입 정규화 (원본 normalizeFontType 동일) */
function normalizeFontType(type: string): string {
  const normalizedTypes: Record<string, string> = {
    TrueType: 'TrueType',
    Type1: 'Type1',
    Type0: 'CID',
    Type3: 'Type3',
    CIDFontType0: 'CID',
    CIDFontType2: 'CID-TrueType',
    OpenType: 'OpenType',
    MMType1: 'MultipleMaster',
  };
  return normalizedTypes[type] || type;
}

/** 표준 폰트 여부 (원본 isStandardFont 동일) */
function isStandardFont(fontName: string): boolean {
  const standardFonts = [
    'Times-Roman',
    'Times-Bold',
    'Times-Italic',
    'Times-BoldItalic',
    'Helvetica',
    'Helvetica-Bold',
    'Helvetica-Oblique',
    'Helvetica-BoldOblique',
    'Courier',
    'Courier-Bold',
    'Courier-Oblique',
    'Courier-BoldOblique',
    'Symbol',
    'ZapfDingbats',
    'TimesNewRoman',
    'TimesNewRomanPS',
    'TimesNewRomanPSMT',
    'Arial',
    'ArialMT',
  ];
  return standardFonts.some(
    (std) => fontName.toLowerCase().includes(std.toLowerCase()),
  );
}

// ============================================================
// 누적 상태(accumulator) — 청크 간 유지
// ============================================================

/**
 * 폰트는 원본이 2단계로 동작한다:
 *   1) 모든 FontDescriptor 를 먼저 훑어 임베딩된 폰트 이름 집합을 만든다.
 *   2) Font/altFont/CIDFont 패턴을 훑어 폰트 목록을 만들되, (1)의 집합으로 임베딩 판정.
 * 스트리밍에서는 청크별로 두 종류의 매치가 흩어져 나오므로, 두 패스 효과를 내려면
 * '원시 매치'를 청크 동안 모아두었다가 마지막에 임베딩을 해소(resolve)해야 한다.
 */
interface FontRawMatch {
  fontName: string;
  fontType: string;
  /** 원본의 어느 루프에서 나왔는지(순서 보존용): font → altFont → cid */
  source: 'font' | 'alt' | 'cid';
}

interface ScanAccumulator {
  // 별색
  spotColorNames: string[];

  // 투명도/오버프린트
  hasTransparency: boolean;
  hasOverprint: boolean;

  // 폰트
  embeddedFontNames: Set<string>;
  fontRawMatches: FontRawMatch[];
  /** 원본 seenFonts 와 동일 — 폰트 이름 첫 등장만 채택 */
  seenFonts: Set<string>;

  // 이미지 — DPI 는 finalize 에서 firstMediaBox 치수로 계산(OFF 와 동일 소스). 스캔 중엔 raw 만.
  seenImages: Set<string>;
  rawImages: { index: number; pixelWidth: number; pixelHeight: number }[];
  imageIndex: number;
  /** 이미지 DPI 용 페이지 치수(pt) = 문서 내 첫 평문 MediaBox(OFF 동일). null 이면 A4 폴백. */
  firstMediaBoxPt: { wPt: number; hPt: number } | null;

  // CMYK 시그니처 (원본 detectCmykStructure 와 동일한 5종)
  cmykHasDeviceCmyk: boolean;
  cmykHasIccBased: boolean;
  cmykHasN4: boolean;
  cmykHasCmykImage: boolean; // /ColorSpace /DeviceCMYK
  cmykHasSeparation: boolean;
  cmykHasDeviceN: boolean;
}

function createAccumulator(): ScanAccumulator {
  return {
    spotColorNames: [],
    hasTransparency: false,
    hasOverprint: false,
    embeddedFontNames: new Set<string>(),
    fontRawMatches: [],
    seenFonts: new Set<string>(),
    seenImages: new Set<string>(),
    rawImages: [],
    imageIndex: 0,
    firstMediaBoxPt: null,
    cmykHasDeviceCmyk: false,
    cmykHasIccBased: false,
    cmykHasN4: false,
    cmykHasCmykImage: false,
    cmykHasSeparation: false,
    cmykHasDeviceN: false,
  };
}

// ============================================================
// 청크 단위 스캔 (각 검출기 regex 적용)
// ============================================================

/**
 * 청크 끝(trailing edge)에 닿은 매치 판정.
 *
 * 가변길이 토큰(예: /Separation /<이름>, /BaseFont /<이름>, <<...>> 딕셔너리)은 8MB
 * 경계에서 잘릴 수 있다. 이때 잘린 청크는 "절단된 짧은 매치"를 만들고(예:
 * /CutCont), 다음 청크는 256KB 오버랩으로 "완전한 매치"(/CutContour)를 다시 만든다.
 * 둘 다 채택하면 원본(전체버퍼)이 본 적 없는 절단 토큰이 이중 등록되어 파리티가 깨진다.
 *
 * 규칙: 매치가 텍스트의 맨 끝까지 닿았고(lastIndex === text.length) 아직 파일 끝이
 * 아니라면(!isFinal), 그 매치는 '절단 의심'이므로 버린다. 절단되지 않았다면 다음
 * 오버랩에서 동일 위치가 재매칭되어 완전한 형태로 채택된다(누락 없음).
 * 파일의 마지막 청크(isFinal)에서는 더 이상 뒤가 없으므로 끝닿음 매치도 채택한다.
 */
function isTruncatedAtEdge(
  matchEndIndex: number,
  textLength: number,
  isFinal: boolean,
): boolean {
  return !isFinal && matchEndIndex >= textLength;
}

/** 별색: /Separation 와 /DeviceN (원본 detectSpotColors regex 동일) */
function scanSpotColors(
  chunk: string,
  acc: ScanAccumulator,
  isFinal: boolean,
): void {
  // /Separation /SpotColorName
  const separationPattern = /\/Separation\s*\/([^\s/[\]]+)/g;
  let match: RegExpExecArray | null;
  while ((match = separationPattern.exec(chunk)) !== null) {
    // 끝에 닿은(절단 의심) 매치는 다음 오버랩에서 완전체로 다시 잡으므로 스킵
    if (isTruncatedAtEdge(separationPattern.lastIndex, chunk.length, isFinal)) {
      continue;
    }
    const colorName = decodeName(match[1]);
    if (!isSystemColor(colorName) && !acc.spotColorNames.includes(colorName)) {
      acc.spotColorNames.push(colorName);
    }
  }

  // /DeviceN [/Color1 /Color2 ...]
  const deviceNPattern = /\/DeviceN\s*\[\s*([^\]]+)\]/g;
  while ((match = deviceNPattern.exec(chunk)) !== null) {
    if (isTruncatedAtEdge(deviceNPattern.lastIndex, chunk.length, isFinal)) {
      continue;
    }
    const colorList = match[1];
    const colorNames = colorList.match(/\/([^\s/[\]]+)/g);
    if (colorNames) {
      for (const name of colorNames) {
        const colorName = decodeName(name.substring(1)); // 선두 / 제거
        if (
          !isSystemColor(colorName) &&
          !acc.spotColorNames.includes(colorName)
        ) {
          acc.spotColorNames.push(colorName);
        }
      }
    }
  }
}

/** 투명도/오버프린트 (원본 detectTransparencyAndOverprint regex 동일) */
function scanTransparencyOverprint(chunk: string, acc: ScanAccumulator): void {
  if (!acc.hasTransparency) {
    const transparencyPatterns = [
      /\/ca\s+([0-9.]+)/g, // Fill alpha
      /\/CA\s+([0-9.]+)/g, // Stroke alpha
      /\/SMask\s*(?!\/None)/g, // Soft mask (None 이 아닌 경우)
      /\/BM\s*\/(?!Normal)[A-Za-z]+/g, // Blend mode (Normal 이 아닌 경우)
    ];
    for (const pattern of transparencyPatterns) {
      const matches = chunk.match(pattern);
      if (matches) {
        for (const m of matches) {
          const alphaMatch = m.match(/\/[cC][aA]\s+([0-9.]+)/);
          if (alphaMatch) {
            const alphaValue = parseFloat(alphaMatch[1]);
            if (alphaValue < 0.999) {
              acc.hasTransparency = true;
              break;
            }
          } else {
            // SMask / BlendMode 존재 → 투명도
            acc.hasTransparency = true;
            break;
          }
        }
        if (acc.hasTransparency) break;
      }
    }
  }

  if (!acc.hasOverprint) {
    const overprintPatterns = [
      /\/OP\s+true/gi, // Stroke overprint
      /\/op\s+true/gi, // Fill overprint
      /\/OPM\s+1/g, // Overprint mode
    ];
    for (const pattern of overprintPatterns) {
      if (pattern.test(chunk)) {
        acc.hasOverprint = true;
        break;
      }
    }
  }
}

/**
 * 폰트 원시 매치 수집 (원본 detectFonts regex 동일, 임베딩 해소는 마지막에).
 *
 * 폰트 regex 는 닫는 `>>` 로 끝나므로 절단된 딕셔너리는 애초에 매치되지 않는다(부분
 * 매치 위험 없음). 그럼에도 끝닿음 매치는 다음 오버랩에서 재매칭되므로, 일관성을 위해
 * 동일한 edge-guard 를 적용한다(중복 등록은 seenFonts/Set 으로도 흡수됨).
 */
function scanFonts(chunk: string, acc: ScanAccumulator, isFinal: boolean): void {
  let match: RegExpExecArray | null;

  // FontDescriptor → 임베딩 폰트 이름 집합
  const fontDescriptorPattern =
    /<<[^>]*\/Type\s*\/FontDescriptor[^>]*\/FontName\s*\/([^\s/[\]>]+)[^>]*(\/FontFile[23]?\s+\d+\s+\d+\s+R)?[^>]*>>/gi;
  while ((match = fontDescriptorPattern.exec(chunk)) !== null) {
    if (isTruncatedAtEdge(fontDescriptorPattern.lastIndex, chunk.length, isFinal)) {
      continue;
    }
    const fontName = decodeName(match[1]);
    const hasFontFile = !!match[2];
    if (hasFontFile) {
      acc.embeddedFontNames.add(fontName);
      const baseNameMatch = fontName.match(/^[A-Z]{6}\+(.+)$/);
      if (baseNameMatch) {
        acc.embeddedFontNames.add(baseNameMatch[1]);
      }
    }
  }

  // Font (Subtype 먼저)
  const fontPattern =
    /<<[^>]*\/Type\s*\/Font[^>]*\/Subtype\s*\/([A-Za-z0-9]+)[^>]*\/BaseFont\s*\/([^\s/[\]>]+)[^>]*>>/gi;
  while ((match = fontPattern.exec(chunk)) !== null) {
    if (isTruncatedAtEdge(fontPattern.lastIndex, chunk.length, isFinal)) continue;
    acc.fontRawMatches.push({
      fontType: match[1],
      fontName: decodeName(match[2]),
      source: 'font',
    });
  }

  // altFont (BaseFont 먼저)
  const altFontPattern =
    /<<[^>]*\/BaseFont\s*\/([^\s/[\]>]+)[^>]*\/Subtype\s*\/([A-Za-z0-9]+)[^>]*\/Type\s*\/Font[^>]*>>/gi;
  while ((match = altFontPattern.exec(chunk)) !== null) {
    if (isTruncatedAtEdge(altFontPattern.lastIndex, chunk.length, isFinal)) continue;
    acc.fontRawMatches.push({
      fontName: decodeName(match[1]),
      fontType: match[2],
      source: 'alt',
    });
  }

  // CIDFont (Type0)
  const cidFontPattern =
    /<<[^>]*\/Type\s*\/Font[^>]*\/Subtype\s*\/Type0[^>]*\/BaseFont\s*\/([^\s/[\]>]+)[^>]*>>/gi;
  while ((match = cidFontPattern.exec(chunk)) !== null) {
    if (isTruncatedAtEdge(cidFontPattern.lastIndex, chunk.length, isFinal)) continue;
    acc.fontRawMatches.push({
      fontName: decodeName(match[1]),
      fontType: 'Type0', // CID 루프는 타입 고정(원본은 type:'CID' 하드코딩)
      source: 'cid',
    });
  }
}

/**
 * MediaBox 캡처 — 문서 내 '첫' 평문 MediaBox 1건만(OFF detectImageResolutionFromPdf 동일).
 * 닫는 ']' 가 있어야 매치되므로 절단 토큰은 자연 무시(오버랩에서 완전체로 재매칭). 첫 캡처 후 잠금.
 */
function scanMediaBox(chunk: string, acc: ScanAccumulator): void {
  if (acc.firstMediaBoxPt) return;
  const m = chunk.match(MEDIABOX_RE);
  if (m) {
    acc.firstMediaBoxPt = { wPt: parseFloat(m[1]), hPt: parseFloat(m[2]) };
  }
}

/**
 * 이미지 raw 수집 — 원본 detectImageResolutionFromPdf 의 픽셀 regex·<50 skip·WxH dedupe·
 * index 증가와 '동일'. ⚠️ DPI 계산은 여기서 하지 않는다: OFF 는 '문서 내 첫 MediaBox'(또는
 * A4)를 기준으로 모든 이미지의 DPI 를 계산하는데, 스트리밍에선 그 MediaBox 가 이미지보다
 * 뒤 청크에 있을 수 있으므로, raw(픽셀 크기)만 모았다가 finalize 에서 firstMediaBox 로 일괄 계산.
 */
function scanImages(chunk: string, acc: ScanAccumulator, isFinal: boolean): void {
  const imagePattern = /<<[^>]*\/Subtype\s*\/Image[^>]*>>/gi;
  const widthPattern = /\/Width\s+(\d+)/;
  const heightPattern = /\/Height\s+(\d+)/;

  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(chunk)) !== null) {
    if (isTruncatedAtEdge(imagePattern.lastIndex, chunk.length, isFinal)) continue;
    const imageDict = match[0];
    const widthMatch = imageDict.match(widthPattern);
    const heightMatch = imageDict.match(heightPattern);

    if (widthMatch && heightMatch) {
      const pixelWidth = parseInt(widthMatch[1], 10);
      const pixelHeight = parseInt(heightMatch[1], 10);

      if (pixelWidth < 50 || pixelHeight < 50) continue; // 원본 동일 skip

      const key = `${pixelWidth}x${pixelHeight}`; // 원본 동일 dedupe 키
      if (acc.seenImages.has(key)) continue;
      acc.seenImages.add(key);

      acc.imageIndex++;
      acc.rawImages.push({ index: acc.imageIndex, pixelWidth, pixelHeight });
    }
  }
}

/** CMYK 시그니처 (원본 detectCmykStructure 와 동일한 검사 — 청크별 OR) */
function scanCmykSignatures(chunk: string, acc: ScanAccumulator): void {
  if (!acc.cmykHasDeviceCmyk && chunk.includes('/DeviceCMYK')) {
    acc.cmykHasDeviceCmyk = true;
  }
  // ICC + N4 는 원본에서 동일 문자열 전체 기준 AND 조건이므로 각각 OR 누적 후 마지막에 AND
  if (!acc.cmykHasIccBased && chunk.includes('/ICCBased')) {
    acc.cmykHasIccBased = true;
  }
  if (!acc.cmykHasN4 && chunk.includes('/N 4')) {
    acc.cmykHasN4 = true;
  }
  if (!acc.cmykHasCmykImage && /\/ColorSpace\s*\/DeviceCMYK/.test(chunk)) {
    acc.cmykHasCmykImage = true;
  }
  if (!acc.cmykHasSeparation && chunk.includes('/Separation')) {
    acc.cmykHasSeparation = true;
  }
  if (!acc.cmykHasDeviceN && chunk.includes('/DeviceN')) {
    acc.cmykHasDeviceN = true;
  }
}

// ============================================================
// 최종 결과 조립
// ============================================================

function finalizeSpot(acc: ScanAccumulator): SpotColorResult {
  const spotColorNames = acc.spotColorNames;
  const pages: { page: number; colors: string[] }[] = [];
  if (spotColorNames.length > 0) {
    pages.push({ page: 1, colors: spotColorNames });
  }
  return {
    hasSpotColors: spotColorNames.length > 0,
    spotColorNames,
    pages,
  };
}

function finalizeTransparency(acc: ScanAccumulator): TransparencyResult {
  return {
    hasTransparency: acc.hasTransparency,
    hasOverprint: acc.hasOverprint,
    pages: [
      {
        page: 1,
        transparency: acc.hasTransparency,
        overprint: acc.hasOverprint,
      },
    ],
  };
}

function finalizeFonts(acc: ScanAccumulator): FontDetectionResult {
  const fonts: FontDetectionResult['fonts'] = [];
  const unembeddedFonts: string[] = [];
  // 원본과 동일한 등장 순서(font → alt → cid)로 처리하기 위해 source 우선 정렬은
  // 하지 않는다. 원본은 세 루프를 순차 실행하므로, 여기서도 source 순으로 처리한다.
  const order: FontRawMatch['source'][] = ['font', 'alt', 'cid'];
  for (const src of order) {
    for (const raw of acc.fontRawMatches) {
      if (raw.source !== src) continue;
      const fontName = raw.fontName;
      if (acc.seenFonts.has(fontName)) continue;
      acc.seenFonts.add(fontName);

      const isSubset = /^[A-Z]{6}\+/.test(fontName);
      const baseName = isSubset ? fontName.substring(7) : fontName;
      const isEmbedded =
        acc.embeddedFontNames.has(fontName) ||
        acc.embeddedFontNames.has(baseName) ||
        isSubset; // 서브셋은 항상 임베딩됨

      const type =
        src === 'cid' ? 'CID' : normalizeFontType(raw.fontType);

      fonts.push({
        name: fontName,
        type,
        embedded: isEmbedded,
        subset: isSubset,
      });

      if (!isEmbedded && !isStandardFont(baseName)) {
        unembeddedFonts.push(fontName);
      }
    }
  }

  const fontCount = fonts.length;
  const hasUnembeddedFonts = unembeddedFonts.length > 0;
  const allFontsEmbedded = !hasUnembeddedFonts;

  return {
    fontCount,
    fonts,
    hasUnembeddedFonts,
    unembeddedFonts,
    allFontsEmbedded,
  };
}

function finalizeResolution(
  acc: ScanAccumulator,
  minDpi: number,
): ImageResolutionResult {
  // 페이지 치수: 문서 내 첫 평문 MediaBox, 없으면 A4 — OFF detectImageResolutionFromPdf 동일.
  const pageWidthPt = acc.firstMediaBoxPt?.wPt ?? A4_WIDTH_PT;
  const pageHeightPt = acc.firstMediaBoxPt?.hPt ?? A4_HEIGHT_PT;
  const pageWidthMm = pageWidthPt * VALIDATION_CONFIG.PT_TO_MM;
  const pageHeightMm = pageHeightPt * VALIDATION_CONFIG.PT_TO_MM;
  const pageRatio = pageWidthMm / pageHeightMm;

  const images: ImageInfo[] = [];
  const lowResImages: ImageInfo[] = [];
  for (const raw of acc.rawImages) {
    const { index, pixelWidth, pixelHeight } = raw;
    // aspect-fit 표시크기 추정 (원본 공식 동일)
    const imageRatio = pixelWidth / pixelHeight;
    let displayWidthMm: number;
    let displayHeightMm: number;
    if (imageRatio > pageRatio) {
      displayWidthMm = pageWidthMm;
      displayHeightMm = pageWidthMm / imageRatio;
    } else {
      displayHeightMm = pageHeightMm;
      displayWidthMm = pageHeightMm * imageRatio;
    }
    const effectiveDpiX = (pixelWidth * 25.4) / displayWidthMm;
    const effectiveDpiY = (pixelHeight * 25.4) / displayHeightMm;
    const minEffectiveDpi = Math.min(effectiveDpiX, effectiveDpiY);
    const imageInfo: ImageInfo = {
      index,
      pixelWidth,
      pixelHeight,
      displayWidthMm: Math.round(displayWidthMm * 10) / 10,
      displayHeightMm: Math.round(displayHeightMm * 10) / 10,
      effectiveDpiX: Math.round(effectiveDpiX),
      effectiveDpiY: Math.round(effectiveDpiY),
      minEffectiveDpi: Math.round(minEffectiveDpi),
    };
    images.push(imageInfo);
    if (minEffectiveDpi < minDpi) lowResImages.push(imageInfo);
  }

  const imageCount = images.length;
  const hasLowResolution = lowResImages.length > 0;
  const minResolution =
    imageCount > 0 ? Math.min(...images.map((img) => img.minEffectiveDpi)) : 0;
  const avgResolution =
    imageCount > 0
      ? Math.round(
          images.reduce((sum, img) => sum + img.minEffectiveDpi, 0) /
            imageCount,
        )
      : 0;

  return {
    imageCount,
    hasLowResolution,
    minResolution,
    avgResolution,
    lowResImages,
    images,
  };
}

function finalizeCmyk(acc: ScanAccumulator): CmykSignatureResult {
  const signatures: string[] = [];
  if (acc.cmykHasDeviceCmyk) signatures.push('DeviceCMYK');
  if (acc.cmykHasIccBased && acc.cmykHasN4) signatures.push('CMYK_ICC_Profile');
  if (acc.cmykHasCmykImage) signatures.push('CMYK_Image');
  if (acc.cmykHasSeparation) signatures.push('Separation_SpotColor');
  if (acc.cmykHasDeviceN) signatures.push('DeviceN');

  const hasCmykSignature = signatures.length > 0;
  const suspectedCmyk = signatures.some(
    (s) => s === 'DeviceCMYK' || s === 'CMYK_ICC_Profile' || s === 'CMYK_Image',
  );

  return { hasCmykSignature, signatures, suspectedCmyk };
}

// ============================================================
// 안전기본값 (각 검출기 catch 와 동일)
// ============================================================

function emptySpot(): SpotColorResult {
  return { hasSpotColors: false, spotColorNames: [], pages: [] };
}
function emptyTransparency(): TransparencyResult {
  return { hasTransparency: false, hasOverprint: false, pages: [] };
}
function emptyFonts(): FontDetectionResult {
  return {
    fontCount: 0,
    fonts: [],
    hasUnembeddedFonts: false,
    unembeddedFonts: [],
    allFontsEmbedded: true,
  };
}
function emptyResolution(): ImageResolutionResult {
  return {
    imageCount: 0,
    hasLowResolution: false,
    minResolution: 0,
    avgResolution: 0,
    lowResImages: [],
    images: [],
  };
}
function emptyCmyk(): CmykSignatureResult {
  return { hasCmykSignature: false, signatures: [], suspectedCmyk: false };
}

// ============================================================
// 메인: 스트리밍 스캔
// ============================================================

/**
 * 파일을 8MB 청크 + 256KB 오버랩으로 순차 스캔하여 5개 검출 결과를 상수 메모리로 누적 반환.
 *
 * @param filePath 스캔할 PDF 파일 경로
 * @param opts     minDpi / pageWidthMm / pageHeightMm (qpdf 메타에서 주입)
 */
export async function scanPdfStreaming(
  filePath: string,
  opts: StreamingScanOptions,
): Promise<StreamingScanResult> {
  const acc = createAccumulator();

  try {
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
      // 직전 청크 끝 256KB 의 latin1 디코드 문자열을 carry 로 보관.
      // 바이트 경계가 latin1 에서는 1:1(0..255 모두 단일 코드포인트)이므로
      // 문자열 길이 == 바이트 길이로 안전하게 오버랩 길이를 맞출 수 있다.
      let carry = '';
      // 절단 의심 edge-guard 는 '이 텍스트가 파일의 마지막인가(isFinal)'를 알아야 한다.
      // 스트림 'data' 이벤트는 마지막 여부를 알려주지 않으므로, 한 청크를 지연 처리한다:
      // 다음 청크가 도착하면 직전 텍스트(=마지막 아님)를 처리하고, 'end' 에서 보류분을
      // isFinal=true 로 마지막 처리한다.
      let pending: string | null = null;

      const process = (text: string, isFinal: boolean) => {
        try {
          scanSpotColors(text, acc, isFinal);
          scanTransparencyOverprint(text, acc);
          scanFonts(text, acc, isFinal);
          scanImages(text, acc, isFinal);
          scanMediaBox(text, acc);
          scanCmykSignatures(text, acc);
        } catch (e) {
          // 청크 처리 중 예외는 스트림 전체를 깨지 않고 로깅만(부분결과 유지).
          logger.warn(`Chunk scan error: ${(e as Error).message}`);
        }
      };

      stream.on('data', (data: Buffer) => {
        // 원본과 동일한 WHATWG latin1(windows-1252) 디코더 사용(파리티 필수).
        const decoded = LATIN1.decode(data);
        const text = carry + decoded;

        // 직전 보류분이 있으면 그것은 마지막이 아니므로 isFinal=false 로 처리.
        if (pending !== null) {
          process(pending, false);
        }
        pending = text;

        // 다음 청크용 carry 계산. 기본은 끝 256KB(짧은 토큰 복원).
        // 단 경계 부근에 '열린' 토큰(<< 딕셔너리, /Separation·/DeviceN 긴 이름)이
        // 기본 오버랩보다 더 앞에서 시작하면 그 시작점부터 통째로 이월한다(MAX_CARRY 상한).
        // → 폰트/이미지 딕셔너리·별색 이름이 청크 경계에서 잘려 누락되는 것을 막는다.
        let cutFrom = Math.max(0, text.length - OVERLAP_SIZE);
        const floor = Math.max(0, text.length - MAX_CARRY);
        for (const tok of ['<<', '/Separation', '/DeviceN']) {
          const idx = text.lastIndexOf(tok);
          if (idx >= floor && idx < cutFrom) cutFrom = idx;
        }
        carry = text.slice(cutFrom);
      });

      stream.on('end', () => {
        // 마지막 보류분을 isFinal=true 로 처리(뒤에 더 없으므로 끝닿음 매치도 채택).
        if (pending !== null) {
          process(pending, true);
        }
        resolve();
      });
      stream.on('error', (err) => reject(err));
    });
  } catch (error) {
    // 파일 열기/읽기 실패 → 5종 모두 안전기본값(원본 각 catch 와 동일 의미).
    logger.warn(`Streaming scan failed: ${(error as Error).message}`);
    return {
      spot: emptySpot(),
      transparency: emptyTransparency(),
      fonts: emptyFonts(),
      resolution: emptyResolution(),
      cmyk: emptyCmyk(),
    };
  }

  return {
    spot: finalizeSpot(acc),
    transparency: finalizeTransparency(acc),
    fonts: finalizeFonts(acc),
    resolution: finalizeResolution(acc, opts.minDpi),
    cmyk: finalizeCmyk(acc),
  };
}
