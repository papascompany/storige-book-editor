import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ObjectStorageService } from './object-storage.service';
import { StorageConfigService } from '../settings/storage-config.service';
import type { EffectiveStorageConfig } from '../settings/storage-config.service';

/**
 * ObjectStorageService — local 백엔드 라운드트립 + 경로 격리 검증.
 * (s3 경로는 실 R2 자격증명 필요 → 단위테스트 범위 밖. 통합/스테이징에서 검증.)
 */
describe('ObjectStorageService (local)', () => {
  let service: ObjectStorageService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `storige-objstore-test-${process.pid}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const localCfg: EffectiveStorageConfig = {
      driver: 'local',
      s3: { endpoint: null, region: 'auto', bucket: null, accessKeyId: null, secretAccessKey: null, forcePathStyle: true },
      retention: { enabled: true, dryRun: false },
      s3Signature: 'local',
    };

    const config: Partial<ConfigService> = {
      get: ((key: string, def?: unknown) => (key === 'STORAGE_PATH' ? tmpDir : def)) as ConfigService['get'],
    };
    const storageConfig: Partial<StorageConfigService> = {
      getEffectiveConfig: jest.fn().mockResolvedValue(localCfg),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectStorageService,
        { provide: ConfigService, useValue: config },
        { provide: StorageConfigService, useValue: storageConfig },
      ],
    }).compile();

    service = module.get(ObjectStorageService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('getActiveBackend 는 local', async () => {
    expect(await service.getActiveBackend()).toBe('local');
  });

  it('put → get 라운드트립 (디렉토리 자동 생성)', async () => {
    const body = Buffer.from('hello pdf bytes');
    const res = await service.put('uploads/abc.pdf', body, 'application/pdf');
    expect(res).toEqual({ backend: 'local', key: 'uploads/abc.pdf' });

    const got = await service.get('local', 'uploads/abc.pdf');
    expect(got.equals(body)).toBe(true);

    const onDisk = await fs.readFile(path.join(tmpDir, 'uploads/abc.pdf'));
    expect(onDisk.equals(body)).toBe(true);
  });

  it('delete 후 get 은 실패 (멱등 — 두 번 삭제 OK)', async () => {
    await service.put('uploads/del.pdf', Buffer.from('x'), 'application/pdf');
    await service.delete('local', 'uploads/del.pdf');
    await expect(service.get('local', 'uploads/del.pdf')).rejects.toBeDefined();
    await expect(service.delete('local', 'uploads/del.pdf')).resolves.toBeUndefined();
  });

  it('path traversal key 차단', async () => {
    await expect(
      service.put('../../etc/evil', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow(/path traversal/i);
    await expect(service.get('local', '../../etc/passwd')).rejects.toThrow(/path traversal/i);
  });
});
