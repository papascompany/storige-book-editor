import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { SessionStatus, SessionMode } from './entities/edit-session.entity';
import { SitesService } from '../sites/sites.service';

describe('EditSessionsController', () => {
  let controller: EditSessionsController;
  let service: jest.Mocked<EditSessionsService>;

  const mockExternalResponse = [
    {
      sessionId: 'session-uuid-1',
      orderSeqno: 12345,
      status: SessionStatus.COMPLETE,
      mode: SessionMode.SPREAD,
      files: {
        cover: '/storage/outputs/job-1/cover.pdf',
        content: '/storage/outputs/job-1/content.pdf',
        merged: '/storage/outputs/job-1/merged.pdf',
      },
      completedAt: new Date('2026-02-19T10:00:00Z'),
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EditSessionsController],
      providers: [
        {
          provide: EditSessionsService,
          useValue: {
            findByOrderExternal: jest.fn().mockResolvedValue(mockExternalResponse),
            findByOrderSeqno: jest.fn(),
            findByMemberSeqno: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            complete: jest.fn(),
            delete: jest.fn(),
            toResponseDto: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test_api_key'),
          },
        },
        {
          provide: SitesService,
          useValue: {
            findByEditorAuthCode: jest.fn().mockResolvedValue(null),
            findByWorkerAuthCode: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    controller = module.get<EditSessionsController>(EditSessionsController);
    service = module.get(EditSessionsService);
  });

  describe('GET /edit-sessions/external', () => {
    it('정상 조회 - orderSeqno로 세션 목록 반환', async () => {
      const result = await controller.findByOrderExternal('12345');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockExternalResponse);
      expect(service.findByOrderExternal).toHaveBeenCalledWith(12345);
    });

    it('orderSeqno 파라미터 누락 - 400 Bad Request', async () => {
      await expect(controller.findByOrderExternal(undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('orderSeqno 빈 문자열 - 400 Bad Request', async () => {
      await expect(controller.findByOrderExternal('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('orderSeqno 비숫자 - 400 Bad Request', async () => {
      await expect(controller.findByOrderExternal('abc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('세션 없음 - success: true, 빈 배열', async () => {
      service.findByOrderExternal.mockResolvedValue([]);

      const result = await controller.findByOrderExternal('99999');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });
});
