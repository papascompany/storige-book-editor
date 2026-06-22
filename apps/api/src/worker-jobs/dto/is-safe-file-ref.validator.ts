import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * 외부 http(s) URL 직접 입력을 거부하는 검증기 (SSRF/미인증 큐적재 방어, P0-1, 2026-06-22).
 *
 * compose-mixed/render-pages 는 @Public(게스트 호출)이라, *Url 필드에 임의 외부 URL 을
 * 넣어 워커가 내부망을 페치하게 만드는 SSRF·미인증 DoS 벡터가 된다. 워커단 SSRF 필터
 * (url-safety.ts)와 더불어 API 경계에서 외부 URL 자체를 1차 거부한다(심층방어).
 *
 * 허용: null/undefined(빈 면지·미지정), /storage/...·절대 로컬경로·상대경로,
 *       api://<fileId>(워커 내부 다운로드 마커). → downloadToTempFile 의 안전분기와 정합.
 * 거부: http://...·https://... (앞 공백·대소문자 포함). 정당 콜러는 fileId/스토리지 경로만 사용.
 *
 * each:true 로 배열(엔드페이퍼 URL 배열)에도 적용 가능 — null 원소는 허용된다.
 */
export function IsSafeFileRef(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeFileRef',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === null || value === undefined) return true; // 빈 면지/미지정
          if (typeof value !== 'string') return false;
          // http/https 스킴이면 거부, 그 외(로컬경로·api://·상대경로)는 허용.
          return !/^\s*https?:\/\//i.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property}: 외부 URL(http/https) 직접 입력은 허용되지 않습니다. 파일 ID 또는 스토리지 경로를 사용하세요.`;
        },
      },
    });
  };
}
