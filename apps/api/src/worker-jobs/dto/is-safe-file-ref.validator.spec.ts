/**
 * P0-1(2026-06-22) — IsSafeFileRef: compose-mixed/render-pages 의 *Url 필드가
 * 외부 http(s) URL 직접 입력(SSRF/미인증 큐적재 벡터)을 거부하고, 정당 입력
 * (스토리지 경로·api://·null 빈면지)은 통과하는지 main.ts 와 동일 파이프로 고정한다.
 */
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateComposeMixedJobDto } from './create-compose-mixed-job.dto';
import { CreateRenderPagesJobDto } from './create-render-pages-job.dto';

describe('IsSafeFileRef (SSRF/미인증 URL 거부)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  const composeMeta = { type: 'body' as const, metatype: CreateComposeMixedJobDto };
  const renderMeta = { type: 'body' as const, metatype: CreateRenderPagesJobDto };

  describe('CreateComposeMixedJobDto', () => {
    it('외부 http URL coverUrl 을 400 으로 거부', async () => {
      await expect(
        pipe.transform({ coverUrl: 'http://169.254.169.254/latest/meta-data/' }, composeMeta),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('외부 https URL contentPdfUrl 을 400 으로 거부', async () => {
      await expect(
        pipe.transform({ contentPdfUrl: 'https://evil.example.com/x.pdf' }, composeMeta),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('앞공백/대문자 우회(  HTTP://) 도 거부', async () => {
      await expect(
        pipe.transform({ coverUrl: '  HTTP://10.0.0.1/x' }, composeMeta),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('엔드페이퍼 배열 원소에 외부 URL 이 있으면 거부', async () => {
      await expect(
        pipe.transform(
          { frontEndpaperUrls: ['/storage/ok.pdf', 'http://internal/x'] },
          composeMeta,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('정당 입력(스토리지 경로·api://·null 빈면지)은 통과', async () => {
      const out = await pipe.transform(
        {
          coverUrl: '/storage/designs/cover.pdf',
          contentPdfUrl: 'api://3f2c-uuid',
          frontEndpaperUrls: ['/storage/ep1.pdf', null],
          backEndpaperUrls: [null, 'storage/ep2.pdf'],
        },
        composeMeta,
      );
      expect(out.coverUrl).toBe('/storage/designs/cover.pdf');
      expect(out.contentPdfUrl).toBe('api://3f2c-uuid');
      expect(out.frontEndpaperUrls).toEqual(['/storage/ep1.pdf', null]);
    });

    it('URL 필드 미지정(undefined)은 통과', async () => {
      const out = await pipe.transform({ coverEditable: true }, composeMeta);
      expect(out.coverUrl).toBeUndefined();
    });
  });

  describe('CreateRenderPagesJobDto', () => {
    it('외부 URL fileUrl 을 400 으로 거부', async () => {
      await expect(
        pipe.transform({ fileUrl: 'http://metadata.google.internal/x' }, renderMeta),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('정당 입력(fileId 만, 또는 스토리지 경로 fileUrl)은 통과', async () => {
      const out1 = await pipe.transform(
        { fileId: '3f2c1a4e-0b6d-4c2a-9e1f-1234567890ab', pageCount: 3 },
        renderMeta,
      );
      expect(out1.fileId).toBe('3f2c1a4e-0b6d-4c2a-9e1f-1234567890ab');

      const out2 = await pipe.transform({ fileUrl: '/storage/inner.pdf' }, renderMeta);
      expect(out2.fileUrl).toBe('/storage/inner.pdf');
    });
  });
});
