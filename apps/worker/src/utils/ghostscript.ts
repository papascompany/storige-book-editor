import { spawn } from 'child_process';
import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { VALIDATION_CONFIG } from '../config/validation.config';
import {
  InkCoverageResult,
  InkCoveragePageResult,
  SpotColorResult,
  TransparencyResult,
  ImageResolutionResult,
  ImageInfo,
  FontDetectionResult,
  FontInfo,
} from '../dto/validation-result.dto';

const logger = new Logger('GhostscriptUtil');

/**
 * Ghostscript 실행 경로
 * Docker 환경에서는 'gs', 로컬 환경에서는 전체 경로가 필요할 수 있음
 */
const GS_PATH = process.env.GHOSTSCRIPT_PATH || 'gs';

/**
 * pdfwrite 출력 시 인쇄 규약(오버프린트/녹아웃/별색)을 보존하기 위한 공통 플래그.
 *
 * 배경:
 *   Ghostscript `pdfwrite` 디바이스는 입력 PDF를 재해석(distill)하여 다시 써낸다.
 *   이 과정에서 아무 옵션도 주지 않으면 ExtGState의 오버프린트 설정(/OP, /op, /OPM)과
 *   Separation/DeviceN(별색) 컬러스페이스가 정규화되며 **조용히 누락**될 수 있다.
 *   오버프린트는 별색 분판(separation) 위에서만 의미가 있으므로, 별색 컬러스페이스를
 *   보존하지 않으면 오버프린트/녹아웃 의도도 함께 깨진다.
 *
 * 보수적 원칙(PRESERVE):
 *   아래 플래그는 새로운 변환을 추가하는 것이 아니라, 원본 PDF에 이미 들어있는
 *   인쇄 의도를 pdfwrite가 **그대로 유지**하도록 지시한다. 오버프린트가 없는 일반
 *   PDF에는 영향이 없다(보존할 설정 자체가 없으므로 no-op).
 *
 *   - `-dPreserveOverprintSettings=true` : ExtGState의 /OP, /op, /OPM 보존 (오버프린트/녹아웃)
 *   - `-dPreserveSeparation=true`        : Separation 별색 컬러스페이스 보존
 *   - `-dPreserveDeviceN=true`           : DeviceN(다중 별색) 컬러스페이스 보존
 *
 * 주의:
 *   이 플래그들은 "보존"만 하며 새 분판/ICC 변환을 생성하지 않는다. 완전한
 *   오버프린트 안전 변환(별색→프로세스 시뮬레이션, knockout 평탄화 등)은 별도
 *   설계가 필요하다(스테이징 검증 후 단계적 도입). 아래 PRINT_PRESERVE_ARGS는
 *   "원본 의도를 떨어뜨리지 않는" 최소·안전 변경에 해당한다.
 */
const PRINT_PRESERVE_ARGS = [
  '-dPreserveOverprintSettings=true',
  '-dPreserveSeparation=true',
  '-dPreserveDeviceN=true',
];

export interface GsOptions {
  /** 입력 파일 경로 */
  input: string;
  /** 출력 파일 경로 */
  output: string;
  /** DPI 해상도 (기본: 300) */
  resolution?: number;
  /** 추가 Ghostscript 옵션 */
  extraArgs?: string[];
}

/**
 * Ghostscript 명령 실행
 */
export async function runGhostscript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const gs = spawn(GS_PATH, args);

    let stdout = '';
    let stderr = '';

    gs.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gs.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gs.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        logger.error(`Ghostscript error: ${stderr}`);
        reject(new Error(`Ghostscript exited with code ${code}: ${stderr}`));
      }
    });

    gs.on('error', (err) => {
      reject(new Error(`Failed to start Ghostscript: ${err.message}`));
    });
  });
}

/**
 * PDF에 블리드 추가 (페이지 확장 + 콘텐츠 중앙 배치)
 */
export async function addBleedToPdf(
  inputPath: string,
  outputPath: string,
  bleedMm: number,
): Promise<void> {
  // 블리드를 포인트로 변환 (1mm = 2.83465 points)
  const bleedPt = bleedMm * 2.83465;

  // PostScript로 블리드 추가
  // 1. 페이지 크기를 블리드만큼 확장
  // 2. 원본 콘텐츠를 블리드 오프셋만큼 이동
  const psCode = `
<< /PageSize [/oldwidth /oldheight] >> setpagedevice
<< /PageSize [oldwidth ${bleedPt * 2} add oldheight ${bleedPt * 2} add] >> setpagedevice
${bleedPt} ${bleedPt} translate
`;

  // Ghostscript를 사용한 블리드 적용
  const args = [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    ...PRINT_PRESERVE_ARGS,
    `-dDEVICEWIDTHPOINTS=${bleedPt * 2}`,
    `-dDEVICEHEIGHTPOINTS=${bleedPt * 2}`,
    `-dFIXEDMEDIA`,
    `-sOutputFile=${outputPath}`,
    `-c`,
    `<< /BeginPage { ${bleedPt} ${bleedPt} translate } bind >> setpagedevice`,
    `-f`,
    inputPath,
  ];

  await runGhostscript(args);
  logger.log(`Added ${bleedMm}mm bleed to PDF: ${outputPath}`);
}

/**
 * PDF 페이지 크기 조정 (확대/축소)
 */
export async function resizePdf(
  inputPath: string,
  outputPath: string,
  targetWidthMm: number,
  targetHeightMm: number,
): Promise<void> {
  // mm를 포인트로 변환
  const widthPt = targetWidthMm * 2.83465;
  const heightPt = targetHeightMm * 2.83465;

  const args = [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    ...PRINT_PRESERVE_ARGS,
    `-dDEVICEWIDTHPOINTS=${widthPt}`,
    `-dDEVICEHEIGHTPOINTS=${heightPt}`,
    '-dFIXEDMEDIA',
    '-dPDFFitPage',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];

  await runGhostscript(args);
  logger.log(`Resized PDF to ${targetWidthMm}x${targetHeightMm}mm: ${outputPath}`);
}

/**
 * PDF를 이미지로 변환 (미리보기 생성)
 */
export async function pdfToImage(
  inputPath: string,
  outputPath: string,
  options: {
    page?: number;
    resolution?: number;
    format?: 'png' | 'jpeg';
  } = {},
): Promise<void> {
  const { page = 1, resolution = 150, format = 'png' } = options;

  const device = format === 'jpeg' ? 'jpeg' : 'png16m';

  const args = [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    `-sDEVICE=${device}`,
    `-r${resolution}`,
    `-dFirstPage=${page}`,
    `-dLastPage=${page}`,
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];

  await runGhostscript(args);
  logger.log(`Generated preview image: ${outputPath}`);
}

/**
 * 여러 PDF 병합
 */
export async function mergePdfs(
  inputPaths: string[],
  outputPath: string,
): Promise<void> {
  const args = [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    ...PRINT_PRESERVE_ARGS,
    `-sOutputFile=${outputPath}`,
    ...inputPaths,
  ];

  await runGhostscript(args);
  logger.log(`Merged ${inputPaths.length} PDFs: ${outputPath}`);
}

/**
 * PDF 정보 추출
 */
export async function getPdfInfo(inputPath: string): Promise<{
  pageCount: number;
  width: number;
  height: number;
}> {
  // pdf-lib를 사용하거나 Ghostscript로 정보 추출
  // 여기서는 간단히 Ghostscript 출력 파싱
  const args = [
    '-q',
    '-dNODISPLAY',
    '-dBATCH',
    '-sFileName=' + inputPath,
    '-c',
    `(${inputPath}) (r) file runpdfbegin pdfpagecount = quit`,
  ];

  try {
    const output = await runGhostscript(args);
    const pageCount = parseInt(output.trim(), 10) || 1;

    // 기본값 반환 (실제로는 더 정교한 파싱 필요)
    return {
      pageCount,
      width: 210, // A4 기본값
      height: 297,
    };
  } catch {
    return {
      pageCount: 1,
      width: 210,
      height: 297,
    };
  }
}

/**
 * Ghostscript 사용 가능 여부 확인
 */
export async function isGhostscriptAvailable(): Promise<boolean> {
  try {
    await runGhostscript(['--version']);
    return true;
  } catch {
    logger.warn('Ghostscript not available');
    return false;
  }
}

// ============================================================
// WBS 3.0: CMYK 2단계 검증
// @see docs/PDF_VALIDATION_WBS.md
// ============================================================

/**
 * WBS 3.2: Ghostscript 명령 실행 (타임아웃 포함)
 * GS 실행 시간이 길어지면 폴백 처리를 위해 타임아웃 적용
 */
export async function runGhostscriptWithTimeout(
  args: string[],
  timeoutMs: number = VALIDATION_CONFIG.GS_TIMEOUT,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const gs = spawn(GS_PATH, args);
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      gs.kill('SIGTERM');
      reject(new Error('Ghostscript timeout'));
    }, timeoutMs);

    gs.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gs.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gs.on('close', (code) => {
      clearTimeout(timeout);
      if (killed) return; // 이미 타임아웃으로 reject됨

      if (code === 0) {
        resolve(stdout);
      } else {
        logger.error(`Ghostscript error: ${stderr}`);
        reject(new Error(`Ghostscript exited with code ${code}: ${stderr}`));
      }
    });

    gs.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start Ghostscript: ${err.message}`));
    });
  });
}

/**
 * WBS 3.2: Ghostscript inkcov 디바이스로 잉크 커버리지 분석
 * CMYK 각 채널의 사용량을 페이지별로 측정
 */
export async function detectCmykUsage(
  inputPath: string,
  maxPages?: number,
): Promise<InkCoverageResult> {
  const effectiveMaxPages = maxPages ?? VALIDATION_CONFIG.GS_MAX_PAGES;

  const args = [
    '-q',
    '-dBATCH',
    '-dNOPAUSE',
    '-dSAFER',
    '-sDEVICE=inkcov',
    `-dLastPage=${effectiveMaxPages}`,
    '-o', '-',
    inputPath,
  ];

  try {
    const output = await runGhostscriptWithTimeout(args);
    return parseInkCoverage(output);
  } catch (error) {
    logger.warn(`inkcov analysis failed: ${error.message}`);
    throw error;
  }
}

/**
 * inkcov 출력 파싱
 * 출력 형식: "0.00000  0.00000  0.00000  0.12345 CMYK OK"
 *            (Cyan    Magenta  Yellow   Black)
 */
function parseInkCoverage(output: string): InkCoverageResult {
  const pages: InkCoveragePageResult[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    // inkcov 출력 패턴: C M Y K 값 (0.0 ~ 1.0)
    const match = line.match(
      /^\s*(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)/,
    );
    if (match) {
      const [, c, m, y, k] = match;
      const cyan = parseFloat(c);
      const magenta = parseFloat(m);
      const yellow = parseFloat(y);
      const black = parseFloat(k);

      // CMY 중 하나라도 0.001 이상이면 CMYK 사용으로 판정
      const hasCmykUsage = cyan > 0.001 || magenta > 0.001 || yellow > 0.001;

      pages.push({
        page: pages.length + 1,
        cyan,
        magenta,
        yellow,
        black,
        hasCmykUsage,
      });
    }
  }

  // 전체 분석 결과
  const totalCmykUsage = pages.some((p) => p.hasCmykUsage);
  const onlyBlack = pages.every((p) => !p.hasCmykUsage && p.black > 0.001);
  const hasAnyInk = pages.some(
    (p) => p.cyan > 0.001 || p.magenta > 0.001 || p.yellow > 0.001 || p.black > 0.001,
  );

  let colorMode: 'CMYK' | 'RGB' | 'GRAY' | 'MIXED';
  if (totalCmykUsage) {
    colorMode = 'CMYK';
  } else if (onlyBlack) {
    colorMode = 'GRAY';
  } else if (!hasAnyInk) {
    colorMode = 'RGB'; // 잉크 사용량이 없으면 RGB로 추정
  } else {
    colorMode = 'MIXED';
  }

  logger.debug(
    `inkcov result: ${pages.length} pages, colorMode=${colorMode}, cmykUsage=${totalCmykUsage}`,
  );

  return {
    pages,
    totalCmykUsage,
    colorMode,
  };
}

// ============================================================
// WBS 4.0: Ghostscript 전용 분석
// @see docs/PDF_VALIDATION_WBS.md
// ============================================================

/**
 * WBS 4.1: 별색(Spot Color) 감지
 * PDF의 ColorSpace에서 Separation/DeviceN 컬러를 탐색
 *
 * PostScript 기반 분석이 복잡하므로, PDF 바이너리 파싱 방식 사용
 * - /Separation 컬러스페이스 감지
 * - /DeviceN 컬러스페이스 감지
 * - 별색 이름 추출
 */
export async function detectSpotColors(
  inputPath: string,
  pdfBytes?: Uint8Array,
): Promise<SpotColorResult> {
  const spotColorNames: string[] = [];
  const pages: { page: number; colors: string[] }[] = [];

  try {
    // PDF 바이너리에서 별색 정보 추출 (PostScript보다 안정적)
    let pdfContent: string;

    if (pdfBytes) {
      pdfContent = new TextDecoder('latin1').decode(pdfBytes);
    } else {
      const fileBuffer = await fs.readFile(inputPath);
      pdfContent = new TextDecoder('latin1').decode(fileBuffer);
    }

    // Separation 컬러스페이스에서 별색 이름 추출
    // 패턴: /ColorSpace [/Separation /SpotColorName ...]
    const separationPattern = /\/Separation\s*\/([^\s/[\]]+)/g;
    let match;
    while ((match = separationPattern.exec(pdfContent)) !== null) {
      const colorName = decodeSpotColorName(match[1]);
      if (!isSystemColor(colorName) && !spotColorNames.includes(colorName)) {
        spotColorNames.push(colorName);
      }
    }

    // DeviceN 컬러스페이스에서 별색 이름 추출
    // 패턴: /DeviceN [/Color1 /Color2 ...] ...
    const deviceNPattern = /\/DeviceN\s*\[\s*([^\]]+)\]/g;
    while ((match = deviceNPattern.exec(pdfContent)) !== null) {
      const colorList = match[1];
      const colorNames = colorList.match(/\/([^\s/[\]]+)/g);
      if (colorNames) {
        for (const name of colorNames) {
          const colorName = decodeSpotColorName(name.substring(1)); // Remove leading /
          if (!isSystemColor(colorName) && !spotColorNames.includes(colorName)) {
            spotColorNames.push(colorName);
          }
        }
      }
    }

    // 페이지별 정보는 단순화 (전체 PDF에서 발견된 별색)
    if (spotColorNames.length > 0) {
      pages.push({
        page: 1,
        colors: spotColorNames,
      });
    }

    logger.debug(
      `Spot color detection: found ${spotColorNames.length} colors: ${spotColorNames.join(', ')}`,
    );

    return {
      hasSpotColors: spotColorNames.length > 0,
      spotColorNames,
      pages,
    };
  } catch (error) {
    logger.warn(`Spot color detection failed: ${error.message}`);
    return {
      hasSpotColors: false,
      spotColorNames: [],
      pages: [],
    };
  }
}

/**
 * 별색 이름 디코딩
 * PDF에서 특수문자는 #XX 형식으로 인코딩됨
 */
function decodeSpotColorName(encoded: string): string {
  return encoded.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * 시스템/프로세스 컬러 여부 확인
 * CMYK 프로세스 컬러는 별색으로 취급하지 않음
 */
function isSystemColor(colorName: string): boolean {
  const systemColors = [
    'Cyan',
    'Magenta',
    'Yellow',
    'Black',
    'None',
    'All',
    'Registration',
    // CMYK 변형
    'Process Cyan',
    'Process Magenta',
    'Process Yellow',
    'Process Black',
  ];
  return systemColors.some(
    (sys) => colorName.toLowerCase() === sys.toLowerCase(),
  );
}

/**
 * WBS 4.2: 투명도/오버프린트 감지
 * PDF의 ExtGState(Graphics State)에서 투명도와 오버프린트 설정 탐색
 *
 * 감지 항목:
 * - /ca (fill alpha, 투명도)
 * - /CA (stroke alpha, 투명도)
 * - /SMask (soft mask, 투명도)
 * - /OP (overprint for stroke)
 * - /op (overprint for fill)
 * - /BM (blend mode, 투명도)
 */
export async function detectTransparencyAndOverprint(
  inputPath: string,
  pdfBytes?: Uint8Array,
): Promise<TransparencyResult> {
  const pages: { page: number; transparency: boolean; overprint: boolean }[] = [];
  let hasTransparency = false;
  let hasOverprint = false;

  try {
    let pdfContent: string;

    if (pdfBytes) {
      pdfContent = new TextDecoder('latin1').decode(pdfBytes);
    } else {
      const fileBuffer = await fs.readFile(inputPath);
      pdfContent = new TextDecoder('latin1').decode(fileBuffer);
    }

    // ExtGState 딕셔너리 탐색
    // 패턴: << /Type /ExtGState ... >>

    // 투명도 감지 패턴들
    const transparencyPatterns = [
      /\/ca\s+([0-9.]+)/g, // Fill alpha (0-1, 1=불투명)
      /\/CA\s+([0-9.]+)/g, // Stroke alpha
      /\/SMask\s*(?!\/None)/g, // Soft mask (None이 아닌 경우)
      /\/BM\s*\/(?!Normal)[A-Za-z]+/g, // Blend mode (Normal이 아닌 경우)
    ];

    // 투명도 검사
    for (const pattern of transparencyPatterns) {
      const matches = pdfContent.match(pattern);
      if (matches) {
        for (const match of matches) {
          // /ca 또는 /CA 값 확인 (1.0 미만이면 투명도 있음)
          const alphaMatch = match.match(/\/[cC][aA]\s+([0-9.]+)/);
          if (alphaMatch) {
            const alphaValue = parseFloat(alphaMatch[1]);
            if (alphaValue < 0.999) {
              hasTransparency = true;
              break;
            }
          } else {
            // SMask 또는 BlendMode가 있으면 투명도
            hasTransparency = true;
            break;
          }
        }
        if (hasTransparency) break;
      }
    }

    // 오버프린트 감지 패턴
    const overprintPatterns = [
      /\/OP\s+true/gi, // Stroke overprint
      /\/op\s+true/gi, // Fill overprint
      /\/OPM\s+1/g, // Overprint mode
    ];

    for (const pattern of overprintPatterns) {
      if (pattern.test(pdfContent)) {
        hasOverprint = true;
        break;
      }
    }

    // 페이지별 정보 (단순화: 전체 PDF 기준)
    pages.push({
      page: 1,
      transparency: hasTransparency,
      overprint: hasOverprint,
    });

    logger.debug(
      `Transparency/Overprint detection: transparency=${hasTransparency}, overprint=${hasOverprint}`,
    );

    return {
      hasTransparency,
      hasOverprint,
      pages,
    };
  } catch (error) {
    logger.warn(`Transparency/Overprint detection failed: ${error.message}`);
    return {
      hasTransparency: false,
      hasOverprint: false,
      pages: [],
    };
  }
}

// ============================================================
// 해상도 감지
// ============================================================

/**
 * PDF 내 이미지 해상도 감지
 * XObject 이미지의 픽셀 크기와 페이지 표시 크기를 비교하여 effective DPI 계산
 *
 * @param pdfBytes PDF 바이너리 데이터
 * @param pageWidthMm 페이지 너비 (mm)
 * @param pageHeightMm 페이지 높이 (mm)
 * @param minDpi 저해상도 판정 기준 (기본: 150 DPI)
 */
export async function detectImageResolution(
  pdfBytes: Uint8Array,
  pageWidthMm: number,
  pageHeightMm: number,
  minDpi: number = VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI,
): Promise<ImageResolutionResult> {
  const images: ImageInfo[] = [];
  const lowResImages: ImageInfo[] = [];

  try {
    const pdfContent = new TextDecoder('latin1').decode(pdfBytes);

    // XObject 이미지 객체 찾기
    // 패턴: /Subtype /Image ... /Width xxx /Height yyy
    const imageObjectPattern =
      /<<[^>]*\/Subtype\s*\/Image[^>]*\/Width\s+(\d+)[^>]*\/Height\s+(\d+)[^>]*>>/gi;

    // 대체 패턴: Width, Height 순서가 다를 수 있음
    const altImagePattern =
      /<<[^>]*\/Height\s+(\d+)[^>]*\/Width\s+(\d+)[^>]*\/Subtype\s*\/Image[^>]*>>/gi;

    // 이미지 크기 추출
    const imageSizes: { width: number; height: number }[] = [];

    let match;
    while ((match = imageObjectPattern.exec(pdfContent)) !== null) {
      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);
      if (width > 0 && height > 0) {
        imageSizes.push({ width, height });
      }
    }

    // 대체 패턴으로 추가 검색
    while ((match = altImagePattern.exec(pdfContent)) !== null) {
      const height = parseInt(match[1], 10);
      const width = parseInt(match[2], 10);
      if (width > 0 && height > 0) {
        // 중복 제거
        const exists = imageSizes.some(
          (s) => s.width === width && s.height === height,
        );
        if (!exists) {
          imageSizes.push({ width, height });
        }
      }
    }

    // 추가 패턴: DCTDecode (JPEG) 이미지
    const dctPattern =
      /\/Width\s+(\d+)\s*\/Height\s+(\d+)[^>]*\/Filter\s*\/DCTDecode/gi;
    while ((match = dctPattern.exec(pdfContent)) !== null) {
      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);
      if (width > 0 && height > 0) {
        const exists = imageSizes.some(
          (s) => s.width === width && s.height === height,
        );
        if (!exists) {
          imageSizes.push({ width, height });
        }
      }
    }

    // 각 이미지의 effective DPI 계산
    // 가정: 이미지가 페이지 전체를 채운다고 가정 (최악의 경우)
    // 실제로는 transform matrix를 파싱해야 정확하지만, 복잡도가 높음
    for (let i = 0; i < imageSizes.length; i++) {
      const { width: pixelWidth, height: pixelHeight } = imageSizes[i];

      // 이미지가 페이지 전체를 채운다고 가정
      // 더 정확한 계산은 transform matrix 파싱 필요
      const displayWidthMm = pageWidthMm;
      const displayHeightMm = pageHeightMm;

      // Effective DPI 계산
      // DPI = (pixels / inches) = (pixels / (mm / 25.4))
      const effectiveDpiX = (pixelWidth * 25.4) / displayWidthMm;
      const effectiveDpiY = (pixelHeight * 25.4) / displayHeightMm;
      const minEffectiveDpi = Math.min(effectiveDpiX, effectiveDpiY);

      const imageInfo: ImageInfo = {
        index: i + 1,
        pixelWidth,
        pixelHeight,
        displayWidthMm: Math.round(displayWidthMm * 10) / 10,
        displayHeightMm: Math.round(displayHeightMm * 10) / 10,
        effectiveDpiX: Math.round(effectiveDpiX),
        effectiveDpiY: Math.round(effectiveDpiY),
        minEffectiveDpi: Math.round(minEffectiveDpi),
      };

      images.push(imageInfo);

      if (minEffectiveDpi < minDpi) {
        lowResImages.push(imageInfo);
      }
    }

    // 결과 계산
    const imageCount = images.length;
    const hasLowResolution = lowResImages.length > 0;
    const minResolution =
      imageCount > 0
        ? Math.min(...images.map((img) => img.minEffectiveDpi))
        : 0;
    const avgResolution =
      imageCount > 0
        ? Math.round(
            images.reduce((sum, img) => sum + img.minEffectiveDpi, 0) /
              imageCount,
          )
        : 0;

    logger.debug(
      `Image resolution detection: ${imageCount} images, min=${minResolution}DPI, avg=${avgResolution}DPI, lowRes=${lowResImages.length}`,
    );

    return {
      imageCount,
      hasLowResolution,
      minResolution,
      avgResolution,
      lowResImages,
      images,
    };
  } catch (error) {
    logger.warn(`Image resolution detection failed: ${error.message}`);
    return {
      imageCount: 0,
      hasLowResolution: false,
      minResolution: 0,
      avgResolution: 0,
      lowResImages: [],
      images: [],
    };
  }
}

// ============================================================
// 폰트 감지
// ============================================================

/**
 * PDF 내 폰트 정보 감지
 * PDF의 Font 객체에서 폰트 이름, 타입, 임베딩 여부 등을 추출
 *
 * 감지 항목:
 * - /BaseFont: 폰트 이름
 * - /Subtype: 폰트 타입 (TrueType, Type1, Type0, CIDFontType2 등)
 * - /FontDescriptor: 폰트 설명자 (임베딩 정보 포함)
 * - /FontFile, /FontFile2, /FontFile3: 임베딩된 폰트 데이터
 *
 * @param pdfBytes PDF 바이너리 데이터
 * @returns FontDetectionResult 폰트 감지 결과
 */
export async function detectFonts(
  pdfBytes: Uint8Array,
): Promise<FontDetectionResult> {
  const fonts: FontInfo[] = [];
  const unembeddedFonts: string[] = [];
  const seenFonts = new Set<string>();

  try {
    const pdfContent = new TextDecoder('latin1').decode(pdfBytes);

    // Font 객체 패턴
    // /Type /Font /Subtype /TrueType /BaseFont /FontName
    const fontPattern =
      /<<[^>]*\/Type\s*\/Font[^>]*\/Subtype\s*\/([A-Za-z0-9]+)[^>]*\/BaseFont\s*\/([^\s/[\]>]+)[^>]*>>/gi;

    // 대체 패턴: BaseFont가 먼저 오는 경우
    const altFontPattern =
      /<<[^>]*\/BaseFont\s*\/([^\s/[\]>]+)[^>]*\/Subtype\s*\/([A-Za-z0-9]+)[^>]*\/Type\s*\/Font[^>]*>>/gi;

    // FontDescriptor에서 임베딩 정보 찾기
    // /FontFile, /FontFile2 (TrueType), /FontFile3 (OpenType/CFF)
    const fontDescriptorPattern =
      /<<[^>]*\/Type\s*\/FontDescriptor[^>]*\/FontName\s*\/([^\s/[\]>]+)[^>]*(\/FontFile[23]?\s+\d+\s+\d+\s+R)?[^>]*>>/gi;

    // 임베딩된 폰트 이름 수집
    const embeddedFontNames = new Set<string>();
    let match;

    while ((match = fontDescriptorPattern.exec(pdfContent)) !== null) {
      const fontName = decodeFontName(match[1]);
      const hasFontFile = !!match[2];

      if (hasFontFile) {
        embeddedFontNames.add(fontName);
        // 서브셋 폰트도 추가 (ABCDEF+FontName 형식)
        const baseNameMatch = fontName.match(/^[A-Z]{6}\+(.+)$/);
        if (baseNameMatch) {
          embeddedFontNames.add(baseNameMatch[1]);
        }
      }
    }

    // 폰트 정보 추출
    while ((match = fontPattern.exec(pdfContent)) !== null) {
      const fontType = match[1];
      const fontName = decodeFontName(match[2]);

      if (seenFonts.has(fontName)) continue;
      seenFonts.add(fontName);

      const isSubset = /^[A-Z]{6}\+/.test(fontName);
      const baseName = isSubset ? fontName.substring(7) : fontName;
      const isEmbedded =
        embeddedFontNames.has(fontName) ||
        embeddedFontNames.has(baseName) ||
        isSubset; // 서브셋은 항상 임베딩됨

      fonts.push({
        name: fontName,
        type: normalizeFontType(fontType),
        embedded: isEmbedded,
        subset: isSubset,
      });

      if (!isEmbedded && !isStandardFont(baseName)) {
        unembeddedFonts.push(fontName);
      }
    }

    // 대체 패턴으로 추가 검색
    while ((match = altFontPattern.exec(pdfContent)) !== null) {
      const fontName = decodeFontName(match[1]);
      const fontType = match[2];

      if (seenFonts.has(fontName)) continue;
      seenFonts.add(fontName);

      const isSubset = /^[A-Z]{6}\+/.test(fontName);
      const baseName = isSubset ? fontName.substring(7) : fontName;
      const isEmbedded =
        embeddedFontNames.has(fontName) ||
        embeddedFontNames.has(baseName) ||
        isSubset;

      fonts.push({
        name: fontName,
        type: normalizeFontType(fontType),
        embedded: isEmbedded,
        subset: isSubset,
      });

      if (!isEmbedded && !isStandardFont(baseName)) {
        unembeddedFonts.push(fontName);
      }
    }

    // CIDFont 패턴 (CJK 폰트)
    const cidFontPattern =
      /<<[^>]*\/Type\s*\/Font[^>]*\/Subtype\s*\/Type0[^>]*\/BaseFont\s*\/([^\s/[\]>]+)[^>]*>>/gi;

    while ((match = cidFontPattern.exec(pdfContent)) !== null) {
      const fontName = decodeFontName(match[1]);

      if (seenFonts.has(fontName)) continue;
      seenFonts.add(fontName);

      const isSubset = /^[A-Z]{6}\+/.test(fontName);
      const baseName = isSubset ? fontName.substring(7) : fontName;
      const isEmbedded =
        embeddedFontNames.has(fontName) ||
        embeddedFontNames.has(baseName) ||
        isSubset;

      fonts.push({
        name: fontName,
        type: 'CID',
        embedded: isEmbedded,
        subset: isSubset,
      });

      if (!isEmbedded && !isStandardFont(baseName)) {
        unembeddedFonts.push(fontName);
      }
    }

    const fontCount = fonts.length;
    const hasUnembeddedFonts = unembeddedFonts.length > 0;
    const allFontsEmbedded = !hasUnembeddedFonts;

    logger.debug(
      `Font detection: ${fontCount} fonts, embedded=${allFontsEmbedded}, unembedded=${unembeddedFonts.length}`,
    );

    return {
      fontCount,
      fonts,
      hasUnembeddedFonts,
      unembeddedFonts,
      allFontsEmbedded,
    };
  } catch (error) {
    logger.warn(`Font detection failed: ${error.message}`);
    return {
      fontCount: 0,
      fonts: [],
      hasUnembeddedFonts: false,
      unembeddedFonts: [],
      allFontsEmbedded: true,
    };
  }
}

/**
 * 폰트 이름 디코딩
 * PDF에서 특수문자는 #XX 형식으로 인코딩됨
 */
function decodeFontName(encoded: string): string {
  return encoded.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * 폰트 타입 정규화
 */
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

/**
 * 표준 폰트 여부 확인
 * PDF 14 표준 폰트는 임베딩 없이 사용 가능
 */
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
    // 변형 이름
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

/**
 * 간소화된 해상도 감지 (페이지 크기 자동 계산)
 * pdf-lib 없이 PDF에서 직접 페이지 크기를 추출하여 해상도 계산
 */
export async function detectImageResolutionFromPdf(
  pdfBytes: Uint8Array,
  minDpi: number = VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI,
): Promise<ImageResolutionResult> {
  const images: ImageInfo[] = [];
  const lowResImages: ImageInfo[] = [];

  try {
    const pdfContent = new TextDecoder('latin1').decode(pdfBytes);

    // MediaBox에서 페이지 크기 추출 (points)
    // 패턴: /MediaBox [0 0 width height]
    const mediaBoxMatch = pdfContent.match(
      /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/,
    );
    let pageWidthPt = 595.28; // A4 기본값
    let pageHeightPt = 841.89;

    if (mediaBoxMatch) {
      pageWidthPt = parseFloat(mediaBoxMatch[1]);
      pageHeightPt = parseFloat(mediaBoxMatch[2]);
    }

    // Points to mm
    const pageWidthMm = pageWidthPt * VALIDATION_CONFIG.PT_TO_MM;
    const pageHeightMm = pageHeightPt * VALIDATION_CONFIG.PT_TO_MM;

    // XObject 이미지에서 크기와 Matrix 정보 추출
    // 이미지 스트림에서 Width/Height 추출
    const imagePattern =
      /<<[^>]*\/Subtype\s*\/Image[^>]*>>/gi;
    const widthPattern = /\/Width\s+(\d+)/;
    const heightPattern = /\/Height\s+(\d+)/;

    let imageIndex = 0;
    let match;
    const seenImages = new Set<string>();

    // 전체 PDF에서 이미지 객체 찾기
    while ((match = imagePattern.exec(pdfContent)) !== null) {
      const imageDict = match[0];
      const widthMatch = imageDict.match(widthPattern);
      const heightMatch = imageDict.match(heightPattern);

      if (widthMatch && heightMatch) {
        const pixelWidth = parseInt(widthMatch[1], 10);
        const pixelHeight = parseInt(heightMatch[1], 10);

        // 너무 작은 이미지는 무시 (아이콘 등)
        if (pixelWidth < 50 || pixelHeight < 50) continue;

        // 중복 이미지 제거
        const key = `${pixelWidth}x${pixelHeight}`;
        if (seenImages.has(key)) continue;
        seenImages.add(key);

        imageIndex++;

        // 이미지 표시 크기 추정
        // 실제 transform matrix 파싱은 복잡하므로,
        // 이미지 비율에 맞춰 페이지에 맞춘다고 가정
        const imageRatio = pixelWidth / pixelHeight;
        const pageRatio = pageWidthMm / pageHeightMm;

        let displayWidthMm: number;
        let displayHeightMm: number;

        if (imageRatio > pageRatio) {
          // 이미지가 더 넓음 - 너비에 맞춤
          displayWidthMm = pageWidthMm;
          displayHeightMm = pageWidthMm / imageRatio;
        } else {
          // 이미지가 더 좁음 - 높이에 맞춤
          displayHeightMm = pageHeightMm;
          displayWidthMm = pageHeightMm * imageRatio;
        }

        // Effective DPI 계산
        const effectiveDpiX = (pixelWidth * 25.4) / displayWidthMm;
        const effectiveDpiY = (pixelHeight * 25.4) / displayHeightMm;
        const minEffectiveDpi = Math.min(effectiveDpiX, effectiveDpiY);

        const imageInfo: ImageInfo = {
          index: imageIndex,
          pixelWidth,
          pixelHeight,
          displayWidthMm: Math.round(displayWidthMm * 10) / 10,
          displayHeightMm: Math.round(displayHeightMm * 10) / 10,
          effectiveDpiX: Math.round(effectiveDpiX),
          effectiveDpiY: Math.round(effectiveDpiY),
          minEffectiveDpi: Math.round(minEffectiveDpi),
        };

        images.push(imageInfo);

        if (minEffectiveDpi < minDpi) {
          lowResImages.push(imageInfo);
        }
      }
    }

    // 결과 계산
    const imageCount = images.length;
    const hasLowResolution = lowResImages.length > 0;
    const minResolution =
      imageCount > 0
        ? Math.min(...images.map((img) => img.minEffectiveDpi))
        : 0;
    const avgResolution =
      imageCount > 0
        ? Math.round(
            images.reduce((sum, img) => sum + img.minEffectiveDpi, 0) /
              imageCount,
          )
        : 0;

    logger.debug(
      `Image resolution detection: ${imageCount} images, min=${minResolution}DPI, avg=${avgResolution}DPI, lowRes=${lowResImages.length}`,
    );

    return {
      imageCount,
      hasLowResolution,
      minResolution,
      avgResolution,
      lowResImages,
      images,
    };
  } catch (error) {
    logger.warn(`Image resolution detection failed: ${error.message}`);
    return {
      imageCount: 0,
      hasLowResolution: false,
      minResolution: 0,
      avgResolution: 0,
      lowResImages: [],
      images: [],
    };
  }
}
