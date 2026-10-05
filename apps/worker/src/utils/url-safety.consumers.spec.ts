/**
 * 입력 주소 거부 오류를 받는 합성 밖 소비자(검증·스트림 다운로드·변환·배경 제거·쪽 렌더)의 오류 형태 고정.
 *
 * 각 소비자의 입력 확보 함수는 쓸 수 없는 입력 주소(형식·스킴·대상 주소)를 받으면 아래 메시지와 name('Error')으로
 * reject 하고, 그 오류는 DomainError 가 아니며 code 가 없다. 검증 FAILED 는 error.message 를, 배경 제거 FAILED 는
 * DomainError 일 때만 코드를 싣는다(validation.processor·cutout.processor).
 */
import { DomainError } from '../common/errors';
import { downloadToTempFile } from './stream-download';
import { PdfValidatorService } from '../services/pdf-validator.service';
import { PdfConverterService } from '../services/pdf-converter.service';
import { PdfPageRendererService } from '../services/pdf-page-renderer.service';
import { CutoutProcessor } from '../processors/cutout.processor';
import { RembgService } from '../services/rembg.service';

type Loader = (url: string) => Promise<unknown>;

function privateLoader(target: object, method: string): Loader {
  const fn = (target as Record<string, unknown>)[method];
  if (typeof fn !== 'function') throw new Error(`loader not found: ${method}`);
  return (url: string) => (fn as (u: string) => Promise<unknown>).call(target, url);
}

const CONSUMERS: ReadonlyArray<readonly [string, () => Loader]> = [
  ['stream-download downloadToTempFile', () => downloadToTempFile],
  ['PdfValidatorService downloadFile', () => privateLoader(new PdfValidatorService(), 'downloadFile')],
  ['PdfConverterService downloadFile', () => privateLoader(new PdfConverterService(), 'downloadFile')],
  ['PdfPageRendererService loadBytes', () => privateLoader(new PdfPageRendererService(), 'loadBytes')],
  [
    'CutoutProcessor loadBytes',
    () => privateLoader(new CutoutProcessor({} as unknown as RembgService), 'loadBytes'),
  ],
];

const UNSAFE_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ['not a url', 'Invalid download URL: not a url'],
  ['ftp://files.example.com/a.pdf', 'Blocked URL scheme: ftp:'],
  ['http://127.0.0.1:4000/api/files/a', 'Blocked private/link-local address: 127.0.0.1'],
];

describe('입력 주소 거부 — 합성 밖 소비자의 오류 형태', () => {
  describe.each(CONSUMERS)('%s', (_name, makeLoader) => {
    it.each(UNSAFE_INPUTS)('%s → 메시지 고정 Error(name Error, DomainError 아님)', async (url, message) => {
      const load = makeLoader();
      const err = await load(url).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(DomainError);
      expect((err as Error).name).toBe('Error');
      expect((err as Error).message).toBe(message);
      expect((err as { code?: unknown }).code).toBeUndefined();
    });
  });
});
