/**
 * ProductProfileDto — 템플릿셋 `productProfile`(P1 캘린더, 2026-10-17) 검증 DTO.
 *
 * 전역 ValidationPipe 가 `whitelist + forbidNonWhitelisted` 라서 ProductProfile 의 모든 중첩 객체를
 * class 로 등재해야 admin 저장이 400 이 되지 않는다. 필드별 형식은 class-validator 데코레이터로,
 * 교차 필드 규칙(pages.count 정합·allowedRange ⊆ 데이터 범위·faces↔canvasLayout 등)은
 * `@storige/types` 의 `validateProductProfile()` 를 단일 출처로 호출해 오류 문구를 그대로 돌려준다.
 *
 * 각 class 는 해당 types 인터페이스를 `implements` 해 엔티티(`ProductProfile | null`)에 그대로 대입된다.
 */
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  CALENDAR_LAYOUTS,
  PRODUCT_CANVAS_LAYOUTS,
  PRODUCT_DUPLEX_FLIPS,
  PRODUCT_KINDS,
  PRODUCT_PAGE_LABEL_RULES,
  PRODUCT_PROFILE_VERSION,
  PRODUCT_SHEET_BINDINGS,
  PRODUCT_SHEET_PAIRINGS,
  validateProductProfile,
} from '@storige/types';
import type {
  CalendarDisplayOptions,
  CalendarLayout,
  CalendarMonthRange,
  CalendarProfile,
  CalendarWeekStart,
  ProductBackRotation,
  ProductCanvasLayout,
  ProductDuplexFlip,
  ProductKind,
  ProductOutputMode,
  ProductOutputPolicy,
  ProductPageLabelRule,
  ProductPagesKind,
  ProductPagesPolicy,
  ProductPageStep,
  ProductPostProcessColorRule,
  ProductPostProcessPolicy,
  ProductProfile,
  ProductSheetBinding,
  ProductSheetFaces,
  ProductSheetPairing,
  ProductSheetPolicy,
} from '@storige/types';

/**
 * 프로파일 전체(교차 필드) 검증 — `validateProductProfile()` 의 오류 배열을 메시지로 돌려준다.
 * class-validator 는 class-level 검증이 없어 `version` 속성에 붙이고 `args.object`(프로파일 전체)를 본다.
 */
export function IsValidProductProfile(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidProductProfile',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          return validateProductProfile(args.object).length === 0;
        },
        defaultMessage(args: ValidationArguments) {
          return `productProfile: ${validateProductProfile(args.object).join('; ')}`;
        },
      },
    });
  };
}

export class ProductPagesPolicyDto implements ProductPagesPolicy {
  @ApiProperty({ enum: ['fixed', 'range'], example: 'fixed', description: '캔버스 수 정책 — fixed(고정) | range(범위)' })
  @IsIn(['fixed', 'range'])
  kind: ProductPagesKind;

  @ApiPropertyOptional({ example: 26, description: "kind='fixed' — 캔버스 수(고정)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;

  @ApiPropertyOptional({ example: 2, description: "kind='range' — 최소 캔버스 수" })
  @IsOptional()
  @IsInt()
  @Min(1)
  min?: number;

  @ApiPropertyOptional({ example: 20, description: "kind='range' — 최대 캔버스 수" })
  @IsOptional()
  @IsInt()
  @Min(1)
  max?: number;

  @ApiPropertyOptional({ enum: [1, 2, 4], example: 2, description: '증감 단위' })
  @IsOptional()
  @IsIn([1, 2, 4])
  step?: ProductPageStep;

  @ApiPropertyOptional({ type: [Number], example: [0, 25], description: '삭제 금지 캔버스 인덱스(표지 등)' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  protectedIndices?: number[];

  @ApiProperty({ enum: PRODUCT_PAGE_LABEL_RULES, example: 'month', description: "페이지 라벨 규칙 — 'month' 는 calendar 전용" })
  @IsIn(PRODUCT_PAGE_LABEL_RULES)
  labelRule: ProductPageLabelRule;
}

export class ProductSheetPolicyDto implements ProductSheetPolicy {
  @ApiProperty({ enum: [1, 2], example: 2, description: '시트 면 수 — 1 단면 / 2 양면' })
  @IsIn([1, 2])
  faces: ProductSheetFaces;

  @ApiProperty({ enum: PRODUCT_CANVAS_LAYOUTS, example: 'canvas-pair', description: 'faces=1 → canvas-per-sheet, faces=2 → canvas-pair' })
  @IsIn(PRODUCT_CANVAS_LAYOUTS)
  canvasLayout: ProductCanvasLayout;

  @ApiProperty({ enum: PRODUCT_SHEET_BINDINGS, example: 'top-ring' })
  @IsIn(PRODUCT_SHEET_BINDINGS)
  binding: ProductSheetBinding;

  @ApiPropertyOptional({ enum: PRODUCT_SHEET_PAIRINGS, example: 'offset-next', description: 'canvas-pair 전용' })
  @IsOptional()
  @IsIn(PRODUCT_SHEET_PAIRINGS)
  pairing?: ProductSheetPairing;

  @ApiProperty({ enum: [0, 180], example: 0, description: '0 = 뒷면 회전은 RIP 책임(현행 유지)' })
  @IsIn([0, 180])
  backRotation: ProductBackRotation;

  @ApiProperty({ enum: PRODUCT_DUPLEX_FLIPS, example: 'short-edge', description: '매니페스트 지시용(산출 무영향)' })
  @IsIn(PRODUCT_DUPLEX_FLIPS)
  duplexFlip: ProductDuplexFlip;
}

export class ProductPostProcessPolicyDto implements ProductPostProcessPolicy {
  @ApiProperty({ example: 1, description: '후가공 파일 쪽수' })
  @IsInt()
  @Min(1)
  pages: number;

  @ApiProperty({ enum: ['upload'], example: 'upload', description: '편집기가 만들지 않는다(업로드)' })
  @IsIn(['upload'])
  source: 'upload';

  @ApiProperty({ enum: ['any', 'spot-only'], example: 'any' })
  @IsIn(['any', 'spot-only'])
  colorRule: ProductPostProcessColorRule;

  @ApiProperty({ example: false })
  @IsBoolean()
  allowTransparency: boolean;
}

export class CalendarMonthRangeDto implements CalendarMonthRange {
  @ApiProperty({ example: '2026-01', description: "'YYYY-MM'" })
  @IsString()
  @MaxLength(7)
  from: string;

  @ApiProperty({ example: '2027-12', description: "'YYYY-MM'" })
  @IsString()
  @MaxLength(7)
  to: string;
}

export class CalendarDisplayOptionsDto implements CalendarDisplayOptions {
  @ApiProperty({ example: true, description: '공휴일 표기' })
  @IsBoolean()
  holidays: boolean;

  @ApiProperty({ example: true, description: '음력 표기' })
  @IsBoolean()
  lunar: boolean;

  @ApiProperty({ example: true, description: '24절기 표기' })
  @IsBoolean()
  solarTerms: boolean;
}

export class CalendarProfileDto implements CalendarProfile {
  @ApiProperty({ enum: CALENDAR_LAYOUTS, example: 'desk', description: '탁상(desk) | 벽걸이 1단(wall-1) | 벽걸이 2단(wall-2)' })
  @IsIn(CALENDAR_LAYOUTS)
  layout: CalendarLayout;

  @ApiProperty({ enum: [12], example: 12 })
  @IsIn([12])
  monthCount: 12;

  @ApiProperty({ example: 1, description: '맨 앞 캔버스 수(표지). 0 허용.' })
  @IsInt()
  @Min(0)
  coverCanvases: number;

  @ApiProperty({ enum: [1, 2], example: 2, description: '월마다 캔버스 수 — 1 (월1면) / 2 (앞·뒤 또는 상단·하단)' })
  @IsIn([1, 2])
  canvasesPerMonth: 1 | 2;

  @ApiProperty({ example: 1, description: '맨 뒤 캔버스 수(에필로그). 0 허용.' })
  @IsInt()
  @Min(0)
  epilogueCanvases: number;

  @ApiPropertyOptional({ type: [String], example: ['앞면', '뒷면'], description: 'canvasesPerMonth=2 일 때 면 라벨 2개(미지정 시 layout 기본값)' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  faceLabels?: [string, string];

  @ApiProperty({ type: CalendarMonthRangeDto, description: '시작연월 허용 범위(날짜 데이터 범위 안)' })
  @ValidateNested()
  @Type(() => CalendarMonthRangeDto)
  allowedRange: CalendarMonthRangeDto;

  @ApiProperty({ enum: [0, 1], example: 0, description: '주 시작 요일 — 0 일요일 / 1 월요일' })
  @IsIn([0, 1])
  weekStart: CalendarWeekStart;

  @ApiProperty({ type: CalendarDisplayOptionsDto, description: '기본 표기 옵션(세션에서 사용자가 바꿀 수 있음)' })
  @ValidateNested()
  @Type(() => CalendarDisplayOptionsDto)
  show: CalendarDisplayOptionsDto;

  @ApiProperty({ example: 'kr-2025-2035-v1', description: '날짜 데이터 버전(CALENDAR_DATA_VERSIONS 키)' })
  @IsString()
  @MaxLength(64)
  dataVersion: string;
}

export class ProductOutputPolicyDto implements ProductOutputPolicy {
  @ApiProperty({ enum: ['single-pdf'], example: 'single-pdf', description: 'P1 은 single-pdf 만' })
  @IsIn(['single-pdf'])
  mode: ProductOutputMode;
}

export class ProductProfileDto implements ProductProfile {
  @ApiProperty({ enum: [PRODUCT_PROFILE_VERSION], example: 1 })
  @IsIn([PRODUCT_PROFILE_VERSION])
  @IsValidProductProfile()
  version: typeof PRODUCT_PROFILE_VERSION;

  @ApiProperty({ enum: PRODUCT_KINDS, example: 'calendar' })
  @IsIn(PRODUCT_KINDS)
  kind: ProductKind;

  @ApiProperty({ example: 'calendar_desk_large', description: '보조 라벨(소문자·숫자·밑줄 1~64자). 분류·운영 식별용 — 동작 분기 금지' })
  @IsString()
  @MaxLength(64)
  editorType: string;

  @ApiProperty({ type: ProductPagesPolicyDto })
  @ValidateNested()
  @Type(() => ProductPagesPolicyDto)
  pages: ProductPagesPolicyDto;

  @ApiProperty({ type: ProductSheetPolicyDto })
  @ValidateNested()
  @Type(() => ProductSheetPolicyDto)
  sheet: ProductSheetPolicyDto;

  @ApiPropertyOptional({ type: ProductPostProcessPolicyDto, description: '후가공 파일 정책(업로드)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductPostProcessPolicyDto)
  postProcess?: ProductPostProcessPolicyDto;

  @ApiPropertyOptional({ type: CalendarProfileDto, description: "kind='calendar' 필수, 그 외 금지" })
  @IsOptional()
  @ValidateNested()
  @Type(() => CalendarProfileDto)
  calendar?: CalendarProfileDto;

  @ApiProperty({ type: ProductOutputPolicyDto })
  @ValidateNested()
  @Type(() => ProductOutputPolicyDto)
  output: ProductOutputPolicyDto;
}
