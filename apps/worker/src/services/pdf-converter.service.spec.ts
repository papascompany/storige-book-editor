/**
 * WK-2 회귀 테스트 (2026-06-13) — PdfConverterService 블리드 sanity 게이트.
 *
 * addBleedToPdf 가 손상 산출물(원본보다 작은 페이지)을 만들면 호출부가
 * 이를 감지해 throw(→ 프로세서가 잡 FAILED 처리)해야 한다.
 * GS 유틸은 전부 mock — 실제 Ghostscript 없이 게이트 로직만 검증한다.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PDFDocument } from 'pdf-lib';

jest.mock('../utils/ghostscript', () => ({
  isGhostscriptAvailable: jest.fn().mockResolvedValue(true),
  addBleedToPdf: jest.fn(),
  resizePdf: jest.fn(),
  pdfToImage: jest.fn(),
  centerOnPage: jest.fn(),
  getPdfInfo: jest.fn(),
}));

import {
  addBleedToPdf,
  getPdfInfo,
  isGhostscriptAvailable,
} from '../utils/ghostscript';
import { PdfConverterService } from './pdf-converter.service';

const mockedAddBleed = addBleedToPdf as jest.MockedFunction<typeof addBleedToPdf>;
const mockedGetPdfInfo = getPdfInfo as jest.MockedFunction<typeof getPdfInfo>;
const mockedGsAvailable = isGhostscriptAvailable as jest.MockedFunction<
  typeof isGhostscriptAvailable
>;

describe('PdfConverterService — WK-2 블리드 sanity 게이트', () => {
  let testDir: string;
  let inputPdfPath: string;
  let outputPdfPath: string;
  let service: PdfConverterService;
  const savedStoragePath = process.env.STORAGE_PATH;

  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storige-wk2-'));
    process.env.STORAGE_PATH = testDir;

    // 실제 1페이지 A4 PDF 픽스처 생성 (최종 단계 pdf-lib 로드용)
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]); // A4 pt
    inputPdfPath = path.join(testDir, 'fixture-input.pdf');
    await fs.writeFile(inputPdfPath, await doc.save());
    outputPdfPath = path.join(testDir, 'fixture-output.pdf');
  });

  afterAll(async () => {
    if (savedStoragePath === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = savedStoragePath;
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGsAvailable.mockResolvedValue(true);
    // addBleedToPdf mock: 입력을 출력으로 복사(파일 존재 보장 — 크기 판정은 getPdfInfo mock 몫)
    mockedAddBleed.mockImplementation(async (input: string, output: string) => {
      await fs.copyFile(input, output);
    });
    // STORAGE_PATH 는 생성자에서 읽으므로 env 세팅 후 인스턴스화
    service = new PdfConverterService();
  });

  const bleedOptions = {
    addPages: false,
    applyBleed: true,
    targetPages: 0,
    bleed: 3,
  };

  it('변환 결과 첫 페이지가 원본보다 작으면 throw 해야 한다 (→ 잡 FAILED)', async () => {
    mockedGetPdfInfo
      // 1) 블리드 적용 전 원본 실측
      .mockResolvedValueOnce({ pageCount: 1, width: 210, height: 297 })
      // 2) 블리드 적용 후 실측 — 종전 버그 재현값(블리드 2배 크기로 잘림)
      .mockResolvedValueOnce({ pageCount: 1, width: 6, height: 6 });

    await expect(
      service.convert(inputPdfPath, bleedOptions, outputPdfPath),
    ).rejects.toThrow(/BLEED_OUTPUT_SMALLER_THAN_INPUT/);

    expect(mockedAddBleed).toHaveBeenCalledWith(expect.any(String), expect.any(String), 3);
  });

  it('너비만 작아져도(부분 손상) throw 해야 한다', async () => {
    mockedGetPdfInfo
      .mockResolvedValueOnce({ pageCount: 1, width: 210, height: 297 })
      .mockResolvedValueOnce({ pageCount: 1, width: 100, height: 303 });

    await expect(
      service.convert(inputPdfPath, bleedOptions, outputPdfPath),
    ).rejects.toThrow(/BLEED_OUTPUT_SMALLER_THAN_INPUT/);
  });

  it('결과가 원본 + 2×블리드 로 커졌으면 정상 완료해야 한다', async () => {
    mockedGetPdfInfo
      .mockResolvedValueOnce({ pageCount: 1, width: 210, height: 297 })
      .mockResolvedValueOnce({ pageCount: 1, width: 216, height: 303 });

    const result = await service.convert(inputPdfPath, bleedOptions, outputPdfPath);

    expect(result.success).toBe(true);
    expect(result.bleedApplied).toBe(true);
    expect(result.finalPageCount).toBe(1);
  });

  it('측정 오차(±0.5mm) 이내의 차이는 통과시켜야 한다 (반올림 흡수)', async () => {
    mockedGetPdfInfo
      .mockResolvedValueOnce({ pageCount: 1, width: 210, height: 297 })
      // 0.3mm 작게 측정된 경우 — getPdfInfo 반올림 오차 범위
      .mockResolvedValueOnce({ pageCount: 1, width: 209.7, height: 296.8 });

    const result = await service.convert(inputPdfPath, bleedOptions, outputPdfPath);
    expect(result.success).toBe(true);
  });

  it('Ghostscript 미가용(pdf-lib 폴백) 경로에는 게이트가 개입하지 않아야 한다', async () => {
    mockedGsAvailable.mockResolvedValue(false);
    service = new PdfConverterService();

    const result = await service.convert(inputPdfPath, bleedOptions, outputPdfPath);

    expect(result.success).toBe(true);
    expect(mockedAddBleed).not.toHaveBeenCalled();
    expect(mockedGetPdfInfo).not.toHaveBeenCalled();
  });
});
