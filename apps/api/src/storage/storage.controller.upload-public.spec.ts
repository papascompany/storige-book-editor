import { Test } from '@nestjs/testing';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { FilesService } from '../files/files.service';
import { FileType } from '../files/entities/file.entity';

// upload-public → files 테이블 정식 등록 계약 (2026-07-13 E2E 적발 균열 잠금)
// 종전: 물리 파일명 uuid 만 반환 → validate/fix-bleed 의 findById 가 FILE_NOT_FOUND.
// 현재: registerExternalFile 로 등록하고 응답 id = DB 레코드 id.
describe('StorageController POST /storage/upload-public — files 등록 계약', () => {
  let controller: StorageController;
  const saveFile = jest.fn();
  const registerExternalFile = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        { provide: StorageService, useValue: { saveFile } },
        { provide: FilesService, useValue: { registerExternalFile } },
      ],
    }).compile();
    controller = moduleRef.get(StorageController);
  });

  const multerFile = (over: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({
      originalname: 'inner.pdf',
      mimetype: 'application/pdf',
      size: 468,
      buffer: Buffer.from('%PDF-1.4'),
      ...over,
    }) as Express.Multer.File;

  it('PDF 업로드를 files 에 등록하고 응답 id 를 DB 레코드 id 로 반환한다', async () => {
    saveFile.mockResolvedValue({
      id: 'physical-uuid',
      originalName: 'inner.pdf',
      filename: 'physical-uuid.pdf',
      path: '/app/storage/uploads/physical-uuid.pdf',
      url: '/storage/uploads/physical-uuid.pdf',
      mimetype: 'application/pdf',
      size: 468,
    });
    registerExternalFile.mockResolvedValue({ id: 'db-record-id' });

    const res = await controller.uploadFilePublic(multerFile());

    expect(saveFile).toHaveBeenCalledWith(expect.anything(), 'uploads');
    expect(registerExternalFile).toHaveBeenCalledWith('/storage/uploads/physical-uuid.pdf', {
      fileType: FileType.CONTENT,
      mimeType: 'application/pdf',
      originalName: 'inner.pdf',
      siteId: null,
    });
    // 응답 id = files 레코드 id (validate/fix-bleed 의 findById 로 해석 가능해야 함)
    expect(res.id).toBe('db-record-id');
    expect(res.url).toBe('/storage/uploads/physical-uuid.pdf');
  });

  it('비-PDF(이미지) 업로드는 FileType.OTHER 로 등록한다', async () => {
    saveFile.mockResolvedValue({
      id: 'img-physical',
      originalName: 'photo.png',
      filename: 'img-physical.png',
      path: '/app/storage/uploads/img-physical.png',
      url: '/storage/uploads/img-physical.png',
      mimetype: 'image/png',
      size: 100,
    });
    registerExternalFile.mockResolvedValue({ id: 'img-db-id' });

    const res = await controller.uploadFilePublic(
      multerFile({ originalname: 'photo.png', mimetype: 'image/png' }),
    );

    expect(registerExternalFile).toHaveBeenCalledWith(
      '/storage/uploads/img-physical.png',
      expect.objectContaining({ fileType: FileType.OTHER, mimeType: 'image/png' }),
    );
    expect(res.id).toBe('img-db-id');
  });

  it('파일 미제공 시 400 — 등록 미호출', async () => {
    await expect(
      controller.uploadFilePublic(undefined as unknown as Express.Multer.File),
    ).rejects.toThrow('No file provided');
    expect(registerExternalFile).not.toHaveBeenCalled();
  });
});
