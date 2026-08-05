import axios from 'axios';
import { RembgService } from './rembg.service';
import { DomainError } from '../common/errors';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * RembgService 스펙 — multipart 를 **손으로 조립**하는 코드라 회귀 그물이 필요하다.
 * CRLF 하나·boundary 종료 마커가 어긋나면 사이드카가 422 를 주고, 그 실패는 로컬이 아니라
 * VPS 첫 실사용에서만 드러난다(리뷰 지적). 에러 분류 경로도 여기서만 실행된다 —
 * cutout.processor.spec 은 이 서비스를 통째로 목킹하기 때문이다.
 */

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const ENV_KEYS = [
  'REMBG_URL',
  'REMBG_ENDPOINT',
  'REMBG_TIMEOUT_MS',
  'REMBG_MODEL',
] as const;

describe('RembgService', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    jest.clearAllMocks();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const okResponse = (data: Buffer = PNG_BYTES, status = 200) => ({
    status,
    data,
    headers: {},
    config: {},
    statusText: 'OK',
  });

  describe('resolveModel', () => {
    it('미지정이면 env 기본값(REMBG_MODEL)을 쓴다', () => {
      process.env.REMBG_MODEL = 'birefnet-general-lite';
      expect(new RembgService().resolveModel()).toBe('birefnet-general-lite');
    });

    it('env 미설정이면 코드 기본값은 compose 기본값과 같은 birefnet-general 이다', () => {
      delete process.env.REMBG_MODEL;
      expect(new RembgService().resolveModel()).toBe('birefnet-general');
    });

    it('허용 문자 밖(경로·쿼리 오염 시도)은 거부한다', () => {
      const svc = new RembgService();
      for (const bad of ['u2net/../etc', 'a b', 'x?y=1', '../../secret', 'a'.repeat(65)]) {
        expect(() => svc.resolveModel(bad)).toThrow(DomainError);
      }
    });

    it('`*_custom` 세션은 거부한다 — CVE-2026-40086 경로 순회 벡터', () => {
      const svc = new RembgService();
      // 밑줄은 허용 문자라 정규식만으로는 통과한다 — 별도 차단이 실제로 동작해야 한다.
      for (const bad of ['u2net_custom', 'ben_custom', 'DIS_CUSTOM', 'x_custom_y']) {
        expect(() => svc.resolveModel(bad)).toThrow(/custom 세션/);
      }
    });
  });

  describe('removeBackground', () => {
    it('multipart 규약대로 조립하고 모델을 **바디 필드**로 보낸다', async () => {
      process.env.REMBG_URL = 'http://rembg:7000';
      process.env.REMBG_ENDPOINT = '/api/remove';
      mockedAxios.post.mockResolvedValue(okResponse());

      const input = Buffer.from('IMAGEBYTES');
      const result = await new RembgService().removeBackground(input, 'u2net');

      expect(result.model).toBe('u2net');
      expect(result.png).toEqual(PNG_BYTES);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      const [url, body, config] = mockedAxios.post.mock.calls[0] as [
        string,
        Buffer,
        { headers: Record<string, string> },
      ];
      // ★ 회귀 잠금: POST 는 model 을 쿼리로 받지 않는다(bgc·extras 만). 쿼리로 보내면
      //   에러 없이 무시되고 기본 모델로 추론돼 결과 model 필드만 거짓이 된다(프로덕션 실적발).
      expect(url).toBe('http://rembg:7000/api/remove');
      expect(url).not.toContain('model=');

      const boundary = /boundary=(.+)$/.exec(config.headers['Content-Type'])?.[1];
      expect(boundary).toBeTruthy();
      const text = body.toString('latin1');
      expect(text.startsWith(`--${boundary}\r\n`)).toBe(true);
      // model 파트가 바디에 실제로 들어갔는지 — 이게 빠지면 조용히 기본 모델로 돈다
      expect(text).toContain('Content-Disposition: form-data; name="model"\r\n\r\nu2net\r\n');
      expect(text).toContain('Content-Disposition: form-data; name="file"; filename="input.png"');
      // 헤더와 본문 사이는 빈 줄 하나, 종료는 `--boundary--\r\n`
      expect(text).toContain('\r\n\r\nIMAGEBYTES\r\n');
      expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
      // Content-Length 가 실제 바디 길이와 일치해야 한다(불일치 시 사이드카가 멈춘다)
      expect(config.headers['Content-Length']).toBe(String(body.length));
    });

    it('입력 바이트를 변형 없이 그대로 싣는다', async () => {
      mockedAxios.post.mockResolvedValue(okResponse());
      // 이미지 바이너리에 흔한 0x00·CR/LF 가 섞여도 손상되면 안 된다
      const input = Buffer.from([0x00, 0x0d, 0x0a, 0xff, 0x2d, 0x2d]);
      await new RembgService().removeBackground(input);

      const body = mockedAxios.post.mock.calls[0][1] as Buffer;
      expect(body.includes(input)).toBe(true);
    });

    it('네트워크 실패(사이드카 미기동)는 SERVICE_UNAVAILABLE 로 분류한다', async () => {
      mockedAxios.post.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.9:7000'));

      await expect(new RembgService().removeBackground(Buffer.from('x'))).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    });

    it('비2xx 는 본문 프리뷰를 포함해 실패시킨다', async () => {
      mockedAxios.post.mockResolvedValue(
        okResponse(Buffer.from('{"detail":"unknown model"}'), 422),
      );

      await expect(
        new RembgService().removeBackground(Buffer.from('x')),
      ).rejects.toThrow(/HTTP 422.*unknown model/);
    });

    it('200 인데 PNG 가 아니면 실패시킨다(에러 JSON 을 .png 로 저장하지 않도록)', async () => {
      mockedAxios.post.mockResolvedValue(okResponse(Buffer.from('<html>oops</html>')));

      await expect(
        new RembgService().removeBackground(Buffer.from('x')),
      ).rejects.toThrow(/PNG 가 아닙니다/);
    });

    it('본문 프리뷰는 200바이트로 잘라 로그·에러를 오염시키지 않는다', async () => {
      mockedAxios.post.mockResolvedValue(okResponse(Buffer.from('E'.repeat(5000)), 500));

      const err: unknown = await new RembgService()
        .removeBackground(Buffer.from('x'))
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message.length).toBeLessThan(400);
    });

    it('모델 키가 부적합하면 사이드카를 호출조차 하지 않는다', async () => {
      await expect(
        new RembgService().removeBackground(Buffer.from('x'), 'u2net_custom'),
      ).rejects.toThrow(DomainError);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });
});
