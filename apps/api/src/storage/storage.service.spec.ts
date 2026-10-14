import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import { StorageService } from './storage.service';
import { STORAGE_UPLOAD_MAX_BYTES } from './storage.constants';

/**
 * SEC-5 — getFilePathFromUrl path traversal 격리 검증.
 * storage 루트(path.resolve) 밖으로 탈출하는 URL 은 BadRequestException 으로 차단되어야 한다.
 */
describe('StorageService', () => {
  let service: StorageService;
  const storagePath = '/app/storage';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'STORAGE_PATH') return storagePath;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  describe('getFilePathFromUrl', () => {
    it('정상 URL (신형식 /storage/<category>/<file>) 은 storage 루트 하위 경로를 반환한다', () => {
      const result = service.getFilePathFromUrl('/storage/uploads/abc.jpg');
      expect(result).toBe(path.join(storagePath, 'uploads', 'abc.jpg'));
    });

    it('정상 URL (구형식 /storage/files/<category>/<file>) 도 처리한다', () => {
      const result = service.getFilePathFromUrl('/storage/files/designs/d.json');
      expect(result).toBe(path.join(storagePath, 'designs', 'd.json'));
    });

    it('썸네일 등 같은 디렉토리 하위 파일도 허용한다', () => {
      const result = service.getFilePathFromUrl(
        '/storage/uploads/abc.thumb-200.jpg',
      );
      expect(result).toBe(path.join(storagePath, 'uploads', 'abc.thumb-200.jpg'));
    });

    it('중첩(3-seg) 라이브러리 에셋 경로를 storage 루트 하위로 해석한다 (getFileNested 지원)', () => {
      // 편집기 라이브러리 에셋은 /storage/library/<subdir>/<file> 형식(클립아트/배경/도형/프레임).
      // StorageController.getFileNested 가 getFile→getFilePathFromUrl 로 위임하는 경로.
      expect(
        service.getFilePathFromUrl('/storage/library/clipart/check.svg'),
      ).toBe(path.join(storagePath, 'library', 'clipart', 'check.svg'));
      expect(
        service.getFilePathFromUrl('/storage/library/bg/sky.png'),
      ).toBe(path.join(storagePath, 'library', 'bg', 'sky.png'));
    });

    it('중첩 경로의 ../ 상위 탈출 시도도 차단한다', () => {
      expect(() =>
        service.getFilePathFromUrl('/storage/library/clipart/../../../etc/passwd'),
      ).toThrow(BadRequestException);
    });

    it('../ 상위 탈출 시도를 차단한다', () => {
      expect(() =>
        service.getFilePathFromUrl('/storage/../../../etc/passwd'),
      ).toThrow(BadRequestException);
    });

    it('카테고리 세그먼트 내부의 ../ 시도를 차단한다', () => {
      expect(() =>
        service.getFilePathFromUrl('/storage/uploads/../../.env'),
      ).toThrow(BadRequestException);
    });

    it('filename 파라미터에 %2F 디코딩으로 섞여 들어온 다단 ../ 를 차단한다', () => {
      // Express 라우트 파라미터는 %2F 디코딩으로 '/' 를 포함할 수 있음
      // (컨트롤러가 url 을 `/storage/${category}/${filename}` 로 조립하는 경로)
      expect(() =>
        service.getFilePathFromUrl('/storage/uploads/../../../etc/passwd'),
      ).toThrow(BadRequestException);
    });

    it('절대 경로 주입(//etc/passwd → /etc/passwd)을 차단한다', () => {
      // relativePath 가 '/etc/passwd' 처럼 절대경로로 평가되어 루트 밖을 가리키는 경우
      expect(() => service.getFilePathFromUrl('/storage//etc/passwd')).toThrow(
        BadRequestException,
      );
      expect(() =>
        service.getFilePathFromUrl('/storage/files//etc/passwd'),
      ).toThrow(BadRequestException);
    });

    it('storage 루트 자체를 가리키는 빈 경로는 허용한다 (루트 반환)', () => {
      const result = service.getFilePathFromUrl('/storage/');
      expect(result).toBe(path.resolve(storagePath));
    });
  });

  describe('deleteFileByUrl', () => {
    it('traversal URL 은 삭제 전에 차단된다', async () => {
      await expect(
        service.deleteFileByUrl('/storage/../../etc/passwd'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('업로드 크기 상한 — 상수 고정', () => {
    const fakeFile = (size: number): Express.Multer.File =>
      ({
        fieldname: 'file',
        originalname: 'x.png',
        encoding: '7bit',
        mimetype: 'image/png',
        size,
        buffer: Buffer.alloc(0),
      }) as Express.Multer.File;

    it('상한(50MB)을 1바이트 넘으면 50MB 메시지의 BadRequestException 으로 거부한다', async () => {
      await expect(
        service.saveFile(fakeFile(STORAGE_UPLOAD_MAX_BYTES + 1)),
      ).rejects.toThrow(
        new BadRequestException('File size exceeds maximum allowed size of 50MB'),
      );
    });

    it('STORAGE_MAX_FILE_SIZE env 값은 무시하고 상수 상한으로 검증한다', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) => {
                if (key === 'STORAGE_PATH') return storagePath;
                if (key === 'STORAGE_MAX_FILE_SIZE') return '1';
                return defaultValue;
              }),
            },
          },
        ],
      }).compile();
      const envService = module.get<StorageService>(StorageService);
      const validator = envService as unknown as {
        validateFile(f: Express.Multer.File): void;
      };

      expect(() =>
        validator.validateFile(fakeFile(STORAGE_UPLOAD_MAX_BYTES)),
      ).not.toThrow();
    });
  });
});
