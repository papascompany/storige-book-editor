import { ConversionProcessor } from './conversion.processor';

jest.mock('../services/job-status.service', () => ({
  JobStatusService: jest.fn().mockImplementation(() => ({
    updateJobStatusWithRetry: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('fs/promises', () => ({ mkdir: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../sentry/sentry.init', () => ({ captureJobException: jest.fn() }));

/**
 * convert-pdf 잡 분기 — colorConvert:'cmyk' 이면 CMYK 변환만 하고 다른 변환(convert)은 타지 않는다.
 */
describe('ConversionProcessor colorConvert 분기', () => {
  const makeConverter = () => ({
    convert: jest.fn().mockResolvedValue({ success: true, outputFileUrl: '/storage/converted/a.pdf' }),
    convertToCmyk: jest.fn().mockResolvedValue({
      success: true,
      outputFileUrl: '/storage/converted/c.pdf',
      colorConverted: 'cmyk',
      finalPageCount: 26,
      outputSize: 900,
    }),
  });

  it("colorConvert 'cmyk' → convertToCmyk 만 호출하고 결과를 COMPLETED 로 보고한다", async () => {
    const converter = makeConverter();
    const processor = new ConversionProcessor(converter as any);
    const status = (processor as any).jobStatusService.updateJobStatusWithRetry as jest.Mock;

    const result = await processor.handleConversion({
      data: { jobId: 'job-1', fileUrl: 'api://file-1', convertOptions: { colorConvert: 'cmyk' } },
    } as any);

    expect(converter.convertToCmyk).toHaveBeenCalledWith('api://file-1', expect.stringMatching(/converted_.*\.pdf$/));
    expect(converter.convert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ colorConverted: 'cmyk', outputFileUrl: '/storage/converted/c.pdf' });
    const completed = status.mock.calls.find((c) => c[1]?.status === 'COMPLETED');
    expect(completed?.[1]).toMatchObject({ outputFileUrl: '/storage/converted/c.pdf' });
  });

  it('colorConvert 없음 → 종전 convert 경로', async () => {
    const converter = makeConverter();
    const processor = new ConversionProcessor(converter as any);
    await processor.handleConversion({
      data: { jobId: 'job-2', fileUrl: '/storage/uploads/x.pdf', convertOptions: { addPages: false, applyBleed: false } },
    } as any);
    expect(converter.convert).toHaveBeenCalledTimes(1);
    expect(converter.convertToCmyk).not.toHaveBeenCalled();
  });

  it('CMYK 변환 실패 → FAILED 보고 후 throw', async () => {
    const converter = makeConverter();
    converter.convertToCmyk.mockRejectedValueOnce(new Error('ICC 프로파일 부재'));
    const processor = new ConversionProcessor(converter as any);
    const status = (processor as any).jobStatusService.updateJobStatusWithRetry as jest.Mock;

    await expect(
      processor.handleConversion({
        data: { jobId: 'job-3', fileUrl: 'api://file-3', convertOptions: { colorConvert: 'cmyk' } },
      } as any),
    ).rejects.toThrow('ICC 프로파일 부재');
    const failed = status.mock.calls.find((c) => c[1]?.status === 'FAILED');
    expect(failed).toBeTruthy();
  });
});
