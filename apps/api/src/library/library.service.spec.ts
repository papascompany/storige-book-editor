import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { decompress as woff2Decompress } from 'wawoff2';
import { LibraryService } from './library.service';
import { LibraryFont } from './entities/font.entity';
import { LibraryBackground } from './entities/background.entity';
import { LibraryClipart } from './entities/clipart.entity';
import { LibraryShape } from './entities/shape.entity';
import { LibraryFrame } from './entities/frame.entity';
import { LibraryCategory } from './entities/category.entity';

jest.mock('axios');
jest.mock('wawoff2', () => ({
  decompress: jest.fn(),
  compress: jest.fn(),
}));

const mockedAxiosGet = axios.get as jest.Mock;
const mockedDecompress = woff2Decompress as jest.Mock;

// 'wOF2' 매직 넘버로 시작하는 가짜 woff2 바이트
const fakeWoff2 = (): Buffer =>
  Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.from([0x00, 0x01, 0x02, 0x03])]);

describe('LibraryService - woff2ToTtf', () => {
  let service: LibraryService;

  const configValues: Record<string, string | undefined> = {
    STORAGE_BASE_URL: 'https://api.papascompany.co.kr/storage',
    FONT_PROXY_ALLOWED_HOSTS: undefined,
  };

  const emptyRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
          },
        },
        { provide: getRepositoryToken(LibraryFont), useValue: emptyRepo() },
        { provide: getRepositoryToken(LibraryBackground), useValue: emptyRepo() },
        { provide: getRepositoryToken(LibraryClipart), useValue: emptyRepo() },
        { provide: getRepositoryToken(LibraryShape), useValue: emptyRepo() },
        { provide: getRepositoryToken(LibraryFrame), useValue: emptyRepo() },
        { provide: getRepositoryToken(LibraryCategory), useValue: emptyRepo() },
      ],
    }).compile();

    service = module.get<LibraryService>(LibraryService);
  });

  it('converts a woff2 from an allowed host into a TTF buffer', async () => {
    const ttf = Buffer.from('OTTO-ttf-bytes');
    mockedAxiosGet.mockResolvedValue({ status: 200, data: fakeWoff2() });
    mockedDecompress.mockResolvedValue(ttf);

    const result = await service.woff2ToTtf(
      'https://api.papascompany.co.kr/storage/fonts/x.woff2',
    );

    expect(result).toBeInstanceOf(Buffer);
    expect(result.equals(ttf)).toBe(true);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
    // SSRF 방어: 리다이렉트 비활성
    expect(mockedAxiosGet.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 });
    expect(mockedDecompress).toHaveBeenCalledTimes(1);
  });

  it('rejects a disallowed host (SSRF protection)', async () => {
    await expect(
      service.woff2ToTtf('https://evil.example.com/font.woff2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedAxiosGet).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(
      service.woff2ToTtf('file:///etc/passwd'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedAxiosGet).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL', async () => {
    await expect(service.woff2ToTtf('not-a-url')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a fetched file that is not a woff2 (bad magic)', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from('NOTWOFF2', 'ascii'),
    });

    await expect(
      service.woff2ToTtf('https://api.papascompany.co.kr/storage/fonts/x.woff2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDecompress).not.toHaveBeenCalled();
  });

  it('wraps upstream fetch failures in BadRequestException', async () => {
    mockedAxiosGet.mockRejectedValue(new Error('network down'));

    await expect(
      service.woff2ToTtf('https://api.papascompany.co.kr/storage/fonts/x.woff2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('honors FONT_PROXY_ALLOWED_HOSTS for additional hosts', async () => {
    configValues.FONT_PROXY_ALLOWED_HOSTS = 'cdn.example.com';
    const ttf = Buffer.from('ttf');
    mockedAxiosGet.mockResolvedValue({ status: 200, data: fakeWoff2() });
    mockedDecompress.mockResolvedValue(ttf);

    const result = await service.woff2ToTtf('https://cdn.example.com/f.woff2');
    expect(result.equals(ttf)).toBe(true);

    configValues.FONT_PROXY_ALLOWED_HOSTS = undefined;
  });
});
