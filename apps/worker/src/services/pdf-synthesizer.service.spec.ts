import { Test, TestingModule } from '@nestjs/testing';
import { PdfSynthesizerService } from './pdf-synthesizer.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SynthesisLocalResult } from '@storige/types';

describe('PdfSynthesizerService', () => {
  let service: PdfSynthesizerService;
  const testStoragePath = '/tmp/storige-test';

  beforeAll(async () => {
    // 테스트용 디렉토리 생성
    await fs.mkdir(testStoragePath, { recursive: true });
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfSynthesizerService],
    }).compile();

    service = module.get<PdfSynthesizerService>(PdfSynthesizerService);

    // private 멤버 오버라이드
    (service as any).storagePath = testStoragePath;
  });

  afterAll(async () => {
    // 테스트 디렉토리 정리
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // 무시
    }
  });

  describe('synthesizeToLocal', () => {
    // 실제 PDF 파일 없이 메서드 시그니처와 반환 타입 테스트
    it('should exist and have correct signature', () => {
      expect(service.synthesizeToLocal).toBeDefined();
      expect(typeof service.synthesizeToLocal).toBe('function');
    });

    describe('SynthesisLocalResult 타입 검증', () => {
      it('merged 모드 결과는 coverPath/contentPath가 없어야 함', () => {
        const mergedResult: SynthesisLocalResult = {
          success: true,
          sourceCoverPath: '/tmp/source_cover.pdf',
          sourceContentPath: '/tmp/source_content.pdf',
          mergedPath: '/tmp/merged.pdf',
          totalPages: 104,
        };

        expect(mergedResult.success).toBe(true);
        expect(mergedResult.mergedPath).toBeDefined();
        expect(mergedResult.coverPath).toBeUndefined();
        expect(mergedResult.contentPath).toBeUndefined();
      });

      it('separate 모드 결과는 coverPath/contentPath가 있어야 함', () => {
        const separateResult: SynthesisLocalResult = {
          success: true,
          sourceCoverPath: '/tmp/source_cover.pdf',
          sourceContentPath: '/tmp/source_content.pdf',
          mergedPath: '/tmp/merged.pdf',
          coverPath: '/tmp/cover.pdf',
          contentPath: '/tmp/content.pdf',
          totalPages: 104,
        };

        expect(separateResult.success).toBe(true);
        expect(separateResult.mergedPath).toBeDefined();
        expect(separateResult.coverPath).toBeDefined();
        expect(separateResult.contentPath).toBeDefined();
      });

      it('source 파일과 output 파일이 분리되어야 함', () => {
        const result: SynthesisLocalResult = {
          success: true,
          sourceCoverPath: '/tmp/source_cover.pdf',
          sourceContentPath: '/tmp/source_content.pdf',
          mergedPath: '/tmp/merged.pdf',
          coverPath: '/tmp/cover.pdf',
          contentPath: '/tmp/content.pdf',
          totalPages: 104,
        };

        // source 파일은 다운로드된 원본
        expect(result.sourceCoverPath).toContain('source');
        expect(result.sourceContentPath).toContain('source');

        // output 파일은 복사/생성된 결과물
        expect(result.mergedPath).not.toContain('source');
        expect(result.coverPath).not.toContain('source');
      });
    });

    // P0-6(2026-06-22): try-finally 자기-정리 — 예외 시 source 임시파일 누수 방어,
    // 정상 경로는 산출물 보존(반환계약 불변).
    describe('임시파일 누수 방어 (P0-6 try-finally)', () => {
      it('합성 중 예외가 나면 다운로드된 source 임시파일을 정리해야 한다', async () => {
        const created: string[] = [];
        jest
          .spyOn(service as any, 'downloadToPath')
          .mockImplementation(async (...args: any[]) => {
            const dest = args[1] as string;
            await fs.writeFile(dest, 'dummy');
            created.push(dest);
          });
        (service as any).gsAvailable = false; // null 체크 우회 → pdf-lib 경로
        jest
          .spyOn(service as any, 'synthesizeWithPdfLib')
          .mockRejectedValue(new Error('boom'));

        await expect(
          service.synthesizeToLocal('cover-url', 'content-url', {
            outputFormat: 'merged',
          }),
        ).rejects.toThrow('boom');

        // source cover + content 두 개가 디스크에 기록됐고
        expect(created).toHaveLength(2);
        // 모두 정리되어 더이상 존재하지 않아야 한다
        for (const p of created) {
          await expect(fs.access(p)).rejects.toThrow();
        }
      });

      it('정상 합성 시 source/merged 산출물을 보존해야 한다(반환계약 불변)', async () => {
        jest
          .spyOn(service as any, 'downloadToPath')
          .mockImplementation(async (...args: any[]) => {
            await fs.writeFile(args[1] as string, 'dummy');
          });
        (service as any).gsAvailable = false;
        jest
          .spyOn(service as any, 'synthesizeWithPdfLib')
          .mockImplementation(async (...args: any[]) => {
            await fs.writeFile(args[2] as string, 'merged'); // mergedPath 생성
            return 10;
          });

        const result = await service.synthesizeToLocal('c', 'ct', {
          outputFormat: 'merged',
        });

        expect(result.success).toBe(true);
        // 정상 경로: 호출자(cleanupTempFiles)가 후속 정리하므로 여기선 보존돼야 함
        await expect(fs.access(result.sourceCoverPath)).resolves.toBeUndefined();
        await expect(fs.access(result.sourceContentPath)).resolves.toBeUndefined();
        await expect(fs.access(result.mergedPath)).resolves.toBeUndefined();
      });
    });
  });

  describe('calculateSpineWidth', () => {
    it('페이지 수와 종이 두께로 책등 폭 계산', () => {
      // 100페이지, 0.1mm 두께 = (100 / 2) * 0.1 = 5mm
      const result = service.calculateSpineWidth(100, 0.1);
      expect(result).toBe(5);
    });

    it('기본 종이 두께 사용', () => {
      // 100페이지, 기본 두께 0.1mm = 5mm
      const result = service.calculateSpineWidth(100);
      expect(result).toBe(5);
    });
  });

  describe('getPaperThickness', () => {
    it('종이 종류별 두께 반환', () => {
      const newsprint = service.getPaperThickness('newsprint', 60);
      const offset = service.getPaperThickness('offset', 80);
      const coated = service.getPaperThickness('coated', 100);
      const artpaper = service.getPaperThickness('artpaper', 100);

      expect(newsprint).toBeCloseTo(0.072, 2);
      expect(offset).toBeCloseTo(0.104, 2);
      expect(coated).toBeCloseTo(0.095, 2);
      expect(artpaper).toBeCloseTo(0.1, 2);
    });
  });
});
