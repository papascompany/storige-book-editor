import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { FilesService } from './files.service';
import { FileEntity, FileType } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';

/**
 * 썸네일 GS 호출 회귀 스펙 (2026-07-30).
 *
 * 배경: `GET /files/:id/thumbnail` 은 파트너 대외 계약 라우트인데 api 컨테이너에 Ghostscript 가
 * 설치돼 있지 않아 프로덕션에서 상시 실패했다(`docker exec storige-api which gs` → 부재).
 * 바이너리는 Dockerfile 에서 설치하되, 함께 적발된 호출부 결함 2건을 이 스펙이 고정한다:
 *
 *  - GS-1 `execFile` 에 timeout 미지정 → 기본값 0(무제한). 손상 PDF 하나가 HTTP 커넥션과
 *    이벤트루프를 영구 점유할 수 있었다. maxBuffer 도 기본 1MB 라 GS 배너만으로도 ENOBUFS
 *    오진 여지가 있어 `-q` 와 함께 상한을 명시한다.
 *  - GS-2 임시 파일명에 width 가 빠져 있어(`_p1_temp.png`) `?width=200`·`?width=400` 동시 요청이
 *    같은 임시 파일을 공유했다. 뒤엉킨 결과가 최종 PNG 로 굳고 1시간 캐시된다.
 *
 * 두 결함 모두 "지워도 테스트가 녹색"인 성질이라(타임아웃 부재는 정상 경로에서 무증상,
 * 경합은 동시 요청에서만 발현) 인자 수준에서 고정하는 것이 유일한 자동 가드다.
 */

// promisify(execFile) 가 감싸는 대상을 가로챈다. 실제 GS 를 실행하지 않고 인자만 관찰한다.
jest.mock('child_process', () => ({
  execFile: jest.fn(
    (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, out: unknown) => void,
    ) => cb(null, { stdout: '', stderr: '' }),
  ),
}));

// sharp 는 체이닝 API — 실제 이미지 처리 없이 통과시킨다.
jest.mock('sharp', () => {
  const chain = {
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue(undefined),
  };
  return { __esModule: true, default: jest.fn(() => chain) };
});

// access 가 항상 실패해야 (a) ensureDirectoryExists 가 mkdir 로, (b) 캐시 확인이 '미스'로 간다.
jest.mock('fs/promises', () => ({
  access: jest.fn().mockRejectedValue(new Error('ENOENT')),
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const execFileMock = execFile as unknown as jest.Mock;

describe('FilesService 썸네일 GS 호출 (회귀 가드)', () => {
  let service: FilesService;

  const pdfFile = (): FileEntity =>
    ({
      id: '22222222-2222-2222-2222-222222222222',
      siteId: null, // assertSiteAccess: caller 미지정이면 어차피 바이패스
      mimeType: 'application/pdf',
      fileName: 'order.pdf',
      filePath: '/app/storage/uploads/order.pdf',
      fileType: FileType.OTHER,
      thumbnailUrl: null,
    }) as unknown as FileEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        {
          provide: getRepositoryToken(FileEntity),
          useValue: {
            findOne: jest.fn().mockImplementation(async () => pdfFile()),
            save: jest.fn().mockResolvedValue(undefined),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, d?: unknown) => d) },
        },
        {
          provide: ObjectStorageService,
          useValue: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    execFileMock.mockClear();
  });

  /** 마지막 GS 호출의 (args, opts) 를 꺼낸다. */
  const lastCall = (): { args: string[]; opts: Record<string, unknown> } => {
    const call = execFileMock.mock.calls[execFileMock.mock.calls.length - 1];
    return { args: call[1] as string[], opts: call[2] as Record<string, unknown> };
  };

  it('GS-1: execFile 에 timeout·maxBuffer 가 명시돼야 한다 (기본값 0=무제한 회귀 방지)', async () => {
    await service.generateThumbnail('22222222-2222-2222-2222-222222222222', 1, 200);

    const { opts } = lastCall();
    expect(typeof opts.timeout).toBe('number');
    expect(opts.timeout as number).toBeGreaterThan(0);
    expect(typeof opts.maxBuffer).toBe('number');
    // 기본 1MB 보다 커야 GS 출력으로 ENOBUFS 오진이 나지 않는다.
    expect(opts.maxBuffer as number).toBeGreaterThan(1024 * 1024);
  });

  it('GS-1: -q 로 배너를 끄고 -dSAFER 를 유지해야 한다', async () => {
    await service.generateThumbnail('22222222-2222-2222-2222-222222222222', 1, 200);

    const { args } = lastCall();
    expect(args).toContain('-q');
    expect(args).toContain('-dSAFER'); // SEC 경계 — 함께 사라지지 않도록 고정
  });

  it('GS-2: 동일 (page,width) 재호출도 임시 파일 경로가 서로 달라야 한다 (동시요청 경합 방지)', async () => {
    await service.generateThumbnail('22222222-2222-2222-2222-222222222222', 1, 200);
    const first = lastCall().args.find((a) => a.startsWith('-sOutputFile='));

    await service.generateThumbnail('22222222-2222-2222-2222-222222222222', 1, 200);
    const second = lastCall().args.find((a) => a.startsWith('-sOutputFile='));

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it('GS-2: width 가 다르면 임시 파일 경로도 달라야 한다', async () => {
    await service.generateThumbnail('22222222-2222-2222-2222-222222222222', 1, 200);
    const w200 = lastCall().args.find((a) => a.startsWith('-sOutputFile=')) ?? '';

    await service.generateThumbnail('22222222-2222-2222-2222-222222222222', 1, 400);
    const w400 = lastCall().args.find((a) => a.startsWith('-sOutputFile=')) ?? '';

    expect(w200).toContain('_w200_');
    expect(w400).toContain('_w400_');
    expect(w200).not.toBe(w400);
  });
});
