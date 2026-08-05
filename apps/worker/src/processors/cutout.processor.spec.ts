import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bull';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import sharp from 'sharp';
import { CUTOUT_JOB_NAME, CutoutJobData } from '@storige/types';
import { CutoutProcessor } from './cutout.processor';
import { RembgService } from '../services/rembg.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * 컷아웃 프로세서 스펙 (2026-08-05, S-P2A-B 샤드2).
 *
 * 네트워크는 타지 않는다 — rembg 사이드카는 provider 목킹, 상태보고 axios.patch 는 모듈 목킹.
 * sharp 만 실물을 쓰되 입력은 수천 픽셀급 단색 이미지라 밀리초 단위다(대용량 처리 없음).
 */
describe('CutoutProcessor', () => {
  let tmpRoot: string;
  let storageDir: string;
  let inputDir: string;

  const envBackup = {
    STORAGE_PATH: process.env.STORAGE_PATH,
    CUTOUT_ENABLED: process.env.CUTOUT_ENABLED,
    CUTOUT_MAX_INPUT_BYTES: process.env.CUTOUT_MAX_INPUT_BYTES,
    CUTOUT_MAX_INPUT_PIXELS: process.env.CUTOUT_MAX_INPUT_PIXELS,
  };

  /** rembg 사이드카 스텁 — 실제 추론 대신 알파 PNG 한 장을 돌려준다. */
  const mockRembgService = {
    removeBackground: jest.fn(),
    resolveModel: jest.fn(),
  };

  /** 단색 이미지 PNG 바이트 생성(테스트 픽스처) */
  const makePng = (width: number, height: number, channels: 3 | 4 = 3): Promise<Buffer> =>
    sharp({
      create: {
        width,
        height,
        channels,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

  const createMockJob = (data: CutoutJobData): Job<CutoutJobData> =>
    ({
      data,
      id: 'test-job-id',
      name: CUTOUT_JOB_NAME,
      queue: {},
      timestamp: Date.now(),
      progress: jest.fn(),
      log: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      retry: jest.fn(),
      discard: jest.fn(),
      finished: jest.fn(),
      moveToCompleted: jest.fn(),
      moveToFailed: jest.fn(),
      promote: jest.fn(),
      lockKey: jest.fn(),
      releaseLock: jest.fn(),
      takeLock: jest.fn(),
      extendLock: jest.fn(),
      toJSON: jest.fn(),
      attemptsMade: 0,
      opts: {},
      stacktrace: [],
      getState: jest.fn(),
      isCompleted: jest.fn(),
      isFailed: jest.fn(),
      isDelayed: jest.fn(),
      isActive: jest.fn(),
      isWaiting: jest.fn(),
      isPaused: jest.fn(),
      isStuck: jest.fn(),
      // Bull Job 은 필드가 많아 테스트에 필요한 부분만 채운다(기존 프로세서 스펙과 동일 관행).
    }) as unknown as Job<CutoutJobData>;

  /** env 는 생성자에서 읽히므로 테스트마다 세팅 후 새로 컴파일한다. */
  const createProcessor = async (): Promise<CutoutProcessor> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CutoutProcessor, { provide: RembgService, useValue: mockRembgService }],
    }).compile();
    return module.get<CutoutProcessor>(CutoutProcessor);
  };

  /** 입력 이미지를 임시 파일로 떨구고 절대경로를 돌려준다(로컬경로 분기 사용). */
  const writeInput = async (name: string, bytes: Buffer): Promise<string> => {
    const p = path.join(inputDir, name);
    await fs.writeFile(p, bytes);
    return p;
  };

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cutout-spec-'));
    storageDir = path.join(tmpRoot, 'storage');
    inputDir = path.join(tmpRoot, 'input');
    await fs.mkdir(storageDir, { recursive: true });
    await fs.mkdir(inputDir, { recursive: true });

    process.env.STORAGE_PATH = storageDir;
    process.env.CUTOUT_ENABLED = 'true';
    delete process.env.CUTOUT_MAX_INPUT_BYTES;
    delete process.env.CUTOUT_MAX_INPUT_PIXELS;

    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ data: {} });
    mockRembgService.resolveModel.mockReturnValue('u2net');
    mockRembgService.removeBackground.mockImplementation(async () => ({
      png: await makePng(64, 64, 4),
      model: 'u2net',
    }));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    process.env.STORAGE_PATH = envBackup.STORAGE_PATH;
    process.env.CUTOUT_ENABLED = envBackup.CUTOUT_ENABLED;
    if (envBackup.CUTOUT_MAX_INPUT_BYTES === undefined) {
      delete process.env.CUTOUT_MAX_INPUT_BYTES;
    } else {
      process.env.CUTOUT_MAX_INPUT_BYTES = envBackup.CUTOUT_MAX_INPUT_BYTES;
    }
    // 픽셀 예산도 테스트에서 바꾸므로 반드시 되돌린다(같은 jest 워커의 후속 테스트 오염 방지)
    if (envBackup.CUTOUT_MAX_INPUT_PIXELS === undefined) {
      delete process.env.CUTOUT_MAX_INPUT_PIXELS;
    } else {
      process.env.CUTOUT_MAX_INPUT_PIXELS = envBackup.CUTOUT_MAX_INPUT_PIXELS;
    }
  });

  const lastPatchPayload = (): Record<string, unknown> =>
    mockedAxios.patch.mock.calls[mockedAxios.patch.mock.calls.length - 1][1] as Record<
      string,
      unknown
    >;

  it('픽셀 캡 발동 — 장변 초과 원본은 축소해 추론하고 원본/입력 치수를 함께 보고한다', async () => {
    const source = await makePng(3000, 1000);
    const fileUrl = await writeInput('big.png', source);
    const processor = await createProcessor();

    const result = await processor.handleCutout(
      createMockJob({ jobId: '11111111-1111-4111-8111-111111111111', fileUrl }),
    );

    // computeInferenceCap(3000, 1000, 2560) → 2560x853
    expect(result.capEngaged).toBe(true);
    expect(result.inputWidth).toBe(2560);
    expect(result.inputHeight).toBe(853);
    expect(result.sourceWidth).toBe(3000);
    expect(result.sourceHeight).toBe(1000);
    expect(result.model).toBe('u2net');
    expect(result.cutoutUrl).toMatch(/^\/storage\/cutouts\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\.png$/);

    // 사이드카에 넘어간 바이트가 실제로 축소된 이미지인지 확인
    expect(mockRembgService.removeBackground).toHaveBeenCalledTimes(1);
    const sent = mockRembgService.removeBackground.mock.calls[0][0] as Buffer;
    const sentMeta = await sharp(sent).metadata();
    expect(sentMeta.width).toBe(2560);
    expect(sentMeta.height).toBe(853);

    // 결과 PNG 와 완료 마커가 실제로 기록됐는지
    const outDir = path.join(storageDir, 'cutouts', '11111111-1111-4111-8111-111111111111');
    const entries = await fs.readdir(outDir);
    expect(entries.filter((n) => n.endsWith('.png'))).toHaveLength(1);
    expect(entries).toContain('result.json');
    // 부분 기록 잔여물(.tmp)이 남으면 안 된다
    expect(entries.some((n) => n.endsWith('.tmp'))).toBe(false);

    expect(lastPatchPayload()).toMatchObject({ status: 'COMPLETED', result });
  });

  it('픽셀 캡 미발동 — 상한 이하 원본은 리사이즈 없이 원본 바이트를 그대로 넘긴다', async () => {
    const source = await makePng(800, 600);
    const fileUrl = await writeInput('small.png', source);
    const processor = await createProcessor();

    const result = await processor.handleCutout(
      createMockJob({ jobId: '22222222-2222-4222-8222-222222222222', fileUrl }),
    );

    expect(result.capEngaged).toBe(false);
    expect(result.inputWidth).toBe(800);
    expect(result.inputHeight).toBe(600);
    expect(result.sourceWidth).toBe(800);
    expect(result.sourceHeight).toBe(600);

    const sent = mockRembgService.removeBackground.mock.calls[0][0] as Buffer;
    expect(sent.equals(source)).toBe(true);
    expect(lastPatchPayload()).toMatchObject({ status: 'COMPLETED' });
  });

  it('멱등 재실행 — 결과가 이미 있으면 재추론 없이 기존 결과로 COMPLETED', async () => {
    const source = await makePng(800, 600);
    const fileUrl = await writeInput('idem.png', source);
    const jobData: CutoutJobData = { jobId: '33333333-3333-4333-8333-333333333333', fileUrl };

    const first = await (await createProcessor()).handleCutout(createMockJob(jobData));
    expect(mockRembgService.removeBackground).toHaveBeenCalledTimes(1);

    // stalled 재실행 시뮬레이션 — 같은 jobId 로 프로세서를 새로 만들어 다시 처리
    const second = await (await createProcessor()).handleCutout(createMockJob(jobData));

    expect(mockRembgService.removeBackground).toHaveBeenCalledTimes(1); // 재추론 없음
    expect(second.cutoutUrl).toBe(first.cutoutUrl);
    expect(second.capEngaged).toBe(first.capEngaged);
    expect(second.sourceWidth).toBe(first.sourceWidth);
    expect(lastPatchPayload()).toMatchObject({ status: 'COMPLETED', result: second });

    // 결과 PNG 는 여전히 1장(중복 산출물 없음)
    const outDir = path.join(storageDir, 'cutouts', '33333333-3333-4333-8333-333333333333');
    const pngs = (await fs.readdir(outDir)).filter((n) => n.endsWith('.png'));
    expect(pngs).toHaveLength(1);
  });

  it('멱등 재실행 — 완료 마커가 소실돼도 PNG 가 있으면 재추론하지 않고 치수를 복원한다', async () => {
    const source = await makePng(3000, 1000);
    const fileUrl = await writeInput('idem-nometa.png', source);
    const jobData: CutoutJobData = { jobId: '44444444-4444-4444-8444-444444444444', fileUrl };

    const first = await (await createProcessor()).handleCutout(createMockJob(jobData));
    const outDir = path.join(storageDir, 'cutouts', '44444444-4444-4444-8444-444444444444');
    await fs.rm(path.join(outDir, 'result.json')); // PNG 기록과 마커 기록 사이 크래시 재현

    const second = await (await createProcessor()).handleCutout(createMockJob(jobData));

    expect(mockRembgService.removeBackground).toHaveBeenCalledTimes(1); // 재추론 없음
    expect(second.cutoutUrl).toBe(first.cutoutUrl);
    expect(second.sourceWidth).toBe(3000);
    expect(second.sourceHeight).toBe(1000);
    expect(second.capEngaged).toBe(true);
    // 출력 PNG 헤더에서 복원한 치수(스텁이 64x64 를 돌려주므로 그 값이 나와야 한다)
    expect(second.inputWidth).toBe(64);
    expect(second.inputHeight).toBe(64);
  });

  it('입력 바이트 상한 초과 — 추론 전에 FAILED 로 끝낸다', async () => {
    const source = await makePng(800, 600);
    const fileUrl = await writeInput('toobig.png', source);
    process.env.CUTOUT_MAX_INPUT_BYTES = '64'; // 어떤 PNG 도 넘길 수 없는 값
    const processor = await createProcessor();

    await expect(
      processor.handleCutout(createMockJob({ jobId: '55555555-5555-4555-8555-555555555555', fileUrl })),
    ).rejects.toThrow(/입력 이미지가 너무 큽니다/);

    expect(mockRembgService.removeBackground).not.toHaveBeenCalled();
    expect(lastPatchPayload()).toMatchObject({
      status: 'FAILED',
      errorMessage: expect.stringContaining('입력 이미지가 너무 큽니다'),
    });
  });

  it('CUTOUT_ENABLED 미설정 — 기본 꺼짐이라 즉시 FAILED', async () => {
    const source = await makePng(800, 600);
    const fileUrl = await writeInput('disabled.png', source);
    delete process.env.CUTOUT_ENABLED;
    const processor = await createProcessor();

    await expect(
      processor.handleCutout(createMockJob({ jobId: '66666666-6666-4666-8666-666666666666', fileUrl })),
    ).rejects.toThrow(/CUTOUT_ENABLED/);

    expect(mockRembgService.removeBackground).not.toHaveBeenCalled();
    expect(lastPatchPayload()).toMatchObject({ status: 'FAILED' });
  });

  it("CUTOUT_ENABLED='1' 도 켜짐으로 해석한다 — API 와 동일 술어", async () => {
    const source = await makePng(64, 64);
    const fileUrl = await writeInput('flag-one.png', source);
    process.env.CUTOUT_ENABLED = '1';
    const processor = await createProcessor();

    await processor.handleCutout(
      createMockJob({ jobId: '77777777-7777-4777-8777-777777777777', fileUrl }),
    );

    expect(mockRembgService.removeBackground).toHaveBeenCalledTimes(1);
    expect(lastPatchPayload()).toMatchObject({ status: 'COMPLETED' });
  });

  it('픽셀 예산 초과 — 바이트 상한을 통과해도 디코드 전에 거부한다', async () => {
    // 단색 대형 이미지는 압축이 잘 돼 바이트 상한(30MB)을 쉽게 통과한다.
    const source = await makePng(4000, 3000); // 12MP
    const fileUrl = await writeInput('manypixels.png', source);
    process.env.CUTOUT_MAX_INPUT_PIXELS = '1000000'; // 1MP 예산
    const processor = await createProcessor();

    await expect(
      processor.handleCutout(
        createMockJob({ jobId: '88888888-8888-4888-8888-888888888888', fileUrl }),
      ),
    ).rejects.toThrow(/픽셀 수가 너무 큽니다/);

    expect(mockRembgService.removeBackground).not.toHaveBeenCalled();
    expect(lastPatchPayload()).toMatchObject({
      status: 'FAILED',
      errorCode: 'CUTOUT_INPUT_TOO_LARGE',
    });
  });

  it('허용 포맷 밖(예: TIFF)은 바이트 판정으로 거부한다 — DB MIME 라벨은 위조 가능', async () => {
    const tiff = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .tiff()
      .toBuffer();
    const fileUrl = await writeInput('fake.png', tiff); // 확장자·라벨은 png 인 척
    const processor = await createProcessor();

    await expect(
      processor.handleCutout(
        createMockJob({ jobId: '99999999-9999-4999-8999-999999999999', fileUrl }),
      ),
    ).rejects.toThrow(/지원하지 않는 이미지 형식/);

    expect(mockRembgService.removeBackground).not.toHaveBeenCalled();
    expect(lastPatchPayload()).toMatchObject({
      status: 'FAILED',
      errorCode: 'CUTOUT_UNSUPPORTED_FORMAT',
    });
  });

  it('비UUID jobId 는 출력 경로에 닿기 전에 거부한다', async () => {
    const source = await makePng(64, 64);
    const fileUrl = await writeInput('badid.png', source);
    const processor = await createProcessor();

    await expect(
      processor.handleCutout(createMockJob({ jobId: '../../etc/passwd', fileUrl })),
    ).rejects.toThrow(/잡 ID 형식/);

    expect(mockRembgService.removeBackground).not.toHaveBeenCalled();
  });
});
