/**
 * ProductProfileDto — 템플릿셋 `productProfile`(P1 캘린더, 2026-10-17 / P2-d 사진인화 `photoPrint`, 2026-10-19) 검증 DTO.
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
  IsNumber,
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
  CALENDAR_YEAR_SPANS,
  PHOTO_BORDERS,
  PHOTO_FINISHES,
  PHOTO_FITS,
  PHOTO_PRINT_COMPOSITIONS,
  PHOTO_PRINT_PROCESSES,
  PHOTO_PRINT_SIZES_PER_PROFILE,
  PRODUCT_CANVAS_LAYOUTS,
  PRODUCT_DUPLEX_FLIPS,
  PRODUCT_KINDS,
  PRODUCT_OUTPUT_MODES,
  PRODUCT_OUTPUT_SHEET_FILES,
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
  CalendarYearPolicy,
  CalendarYearSelectRange,
  CalendarYearSpan,
  PhotoBorder,
  PhotoFinish,
  PhotoFit,
  PhotoPrintComposition,
  PhotoPrintCopiesPolicy,
  PhotoPrintOptionsPolicy,
  PhotoPrintProcess,
  PhotoPrintProfile,
  PhotoPrintSize,
  PhotoPrintUploadPolicy,
  ProductBackRotation,
  ProductCanvasLayout,
  ProductDuplexFlip,
  ProductKind,
  ProductOutputMode,
  ProductOutputPolicy,
  ProductOutputSheetFiles,
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

  @ApiProperty({ enum: PRODUCT_PAGE_LABEL_RULES, example: 'month', description: "페이지 라벨 규칙 — 'month' 는 calendar, 'photo' 는 photo-print 전용" })
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

  /** 2026-10-17 오너 결정: 임시공휴일·선거일(데이터 temporary)은 기본 미표시, 고객 선택. 생략 = false. */
  @ApiPropertyOptional({ example: false, description: '임시공휴일·선거일(공표분) 표기 — 생략/false 는 법정 공휴일만' })
  @IsOptional()
  @IsBoolean()
  temporaryHolidays?: boolean;

  /** v1.26(오너 답 Q3, 2026-10-24): 연달력(그리드 variant 'year') 연도 제목 표시. 생략 = true. */
  @ApiPropertyOptional({ example: true, description: "연달력 연도 제목 표시(v1.26) — 생략 = 표시. 템플릿 그리드 style.showTitle=false 면 표시 안 함" })
  @IsOptional()
  @IsBoolean()
  yearTitle?: boolean;
}

export class CalendarYearSelectRangeDto implements CalendarYearSelectRange {
  @ApiProperty({ example: 0, description: '시작연도 기준 최소 연도 이동(-2~2)' })
  @IsInt()
  minDelta: number;

  @ApiProperty({ example: 1, description: '시작연도 기준 최대 연도 이동(-2~2)' })
  @IsInt()
  maxDelta: number;
}

export class CalendarYearPolicyDto implements CalendarYearPolicy {
  @ApiPropertyOptional({
    enum: CALENDAR_YEAR_SPANS,
    example: 'calendar-year',
    description: "연달력 기간 기준 — 'calendar-year' 기준 연도 1~12월 / 'start-span' 시작연월부터. 생략 = 기본 규칙(1월 시작이면 calendar-year, 아니면 start-span)",
  })
  @IsOptional()
  @IsIn(CALENDAR_YEAR_SPANS)
  span?: CalendarYearSpan;

  @ApiPropertyOptional({ type: CalendarYearSelectRangeDto, description: '고객 연도 선택 허용 폭(생략 = 선택 없음)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CalendarYearSelectRangeDto)
  select?: CalendarYearSelectRangeDto;
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

  @ApiPropertyOptional({ type: CalendarYearPolicyDto, description: '연달력 정책(v1.26, 생략 = 기본 규칙·고객 연도 선택 없음)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CalendarYearPolicyDto)
  yearPolicy?: CalendarYearPolicyDto;
}

// ─── 사진인화(P2-d) ──────────────────────────────────────────────────────────

export class PhotoPrintSizeDto implements PhotoPrintSize {
  @ApiProperty({ example: '4x6', description: "사이즈 코드(호스트·매니페스트 식별용). 영숫자·'_'·'-' 1~32자" })
  @IsString()
  @MaxLength(32)
  code: string;

  @ApiProperty({ example: 102, description: '가로(mm)' })
  @IsNumber()
  widthMm: number;

  @ApiProperty({ example: 152, description: '세로(mm)' })
  @IsNumber()
  heightMm: number;

  @ApiProperty({ example: 200, description: '저해상 경고 기준 DPI(미달 시 items[].lowRes, 완료 차단 없음)' })
  @IsInt()
  @Min(1)
  minDpi: number;
}

export class PhotoPrintOptionsPolicyDto implements PhotoPrintOptionsPolicy {
  @ApiProperty({ enum: PHOTO_BORDERS, isArray: true, example: ['none', 'white'], description: '허용 테두리(첫 원소 = 기본값)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(PHOTO_BORDERS, { each: true })
  border: PhotoBorder[];

  @ApiProperty({ enum: PHOTO_FITS, isArray: true, example: ['paper-full', 'image-full'], description: '허용 맞춤(페이퍼풀 cover / 이미지풀 contain, 첫 원소 = 기본값)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(PHOTO_FITS, { each: true })
  fit: PhotoFit[];

  @ApiProperty({ enum: PHOTO_FINISHES, isArray: true, example: ['matte', 'glossy'], description: '허용 마감(통과만, 첫 원소 = 기본값)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(PHOTO_FINISHES, { each: true })
  finish: PhotoFinish[];

  @ApiProperty({ example: true, description: '밝기 보정 제공 여부(통과만)' })
  @IsBoolean()
  brightnessFix: boolean;

  @ApiProperty({ example: true, description: '촬영일 표기 제공 여부(편집기 소비)' })
  @IsBoolean()
  dateOverlay: boolean;

  @ApiProperty({ example: true, description: '흑백 제공 여부(편집기 소비)' })
  @IsBoolean()
  grayscale: boolean;

  @ApiPropertyOptional({ example: 2, description: '유테 시 사진틀 창 축소 mm(생략 = 2)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  borderInsetMm?: number;
}

export class PhotoPrintCopiesDto implements PhotoPrintCopiesPolicy {
  @ApiProperty({ example: 1, description: '항목당 최소 매수' })
  @IsInt()
  @Min(1)
  min: number;

  @ApiProperty({ example: 99, description: '항목당 최대 매수' })
  @IsInt()
  @Min(1)
  max: number;
}

export class PhotoPrintUploadDto implements PhotoPrintUploadPolicy {
  @ApiProperty({ example: 200, description: '세션당 업로드 사진 수 상한' })
  @IsInt()
  @Min(1)
  maxPhotos: number;

  @ApiProperty({ example: 25, description: '사진 1장 크기 상한(MB)' })
  @IsNumber()
  maxMb: number;
}

export class PhotoPrintProfileDto implements PhotoPrintProfile {
  @ApiProperty({ enum: PHOTO_PRINT_PROCESSES, example: 'chemical', description: '인화(chemical, 단면) | 인쇄(digital, 양면)' })
  @IsIn(PHOTO_PRINT_PROCESSES)
  process: PhotoPrintProcess;

  @ApiProperty({ enum: PHOTO_PRINT_COMPOSITIONS, example: 'per-photo-free-back', description: '① 사진별 자유 뒷면 | ② 사진별 고정 뒷면(backTemplateId) | ③ 카드형' })
  @IsIn(PHOTO_PRINT_COMPOSITIONS)
  composition: PhotoPrintComposition;

  @ApiProperty({ type: [PhotoPrintSizeDto], description: `P2 는 정확히 ${PHOTO_PRINT_SIZES_PER_PROFILE}개(1세션 1사이즈)` })
  @IsArray()
  @ArrayMinSize(PHOTO_PRINT_SIZES_PER_PROFILE)
  @ArrayMaxSize(PHOTO_PRINT_SIZES_PER_PROFILE)
  @ValidateNested({ each: true })
  @Type(() => PhotoPrintSizeDto)
  sizes: PhotoPrintSizeDto[];

  @ApiProperty({ type: PhotoPrintOptionsPolicyDto })
  @ValidateNested()
  @Type(() => PhotoPrintOptionsPolicyDto)
  options: PhotoPrintOptionsPolicyDto;

  @ApiProperty({ type: PhotoPrintCopiesDto })
  @ValidateNested()
  @Type(() => PhotoPrintCopiesDto)
  copies: PhotoPrintCopiesDto;

  @ApiPropertyOptional({ example: 'ffffffff-ffff-4fff-8fff-ffffffffffff', description: "composition='per-photo-fixed-back' 필수 — 뒷면 고정 템플릿 id" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  backTemplateId?: string;

  @ApiProperty({ type: PhotoPrintUploadDto })
  @ValidateNested()
  @Type(() => PhotoPrintUploadDto)
  upload: PhotoPrintUploadDto;
}

export class ProductOutputPolicyDto implements ProductOutputPolicy {
  @ApiProperty({ enum: PRODUCT_OUTPUT_MODES, example: 'single-pdf', description: "single-pdf(P1, 편집기 산출 그대로) | sheet-map(P2, API buildSheetMap → worker 'sheet-map')" })
  @IsIn(PRODUCT_OUTPUT_MODES)
  mode: ProductOutputMode;

  @ApiPropertyOptional({ enum: PRODUCT_OUTPUT_SHEET_FILES, example: 'per-sheet', description: "mode='sheet-map' 전용. 생략 = per-sheet" })
  @IsOptional()
  @IsIn(PRODUCT_OUTPUT_SHEET_FILES)
  sheetFiles?: ProductOutputSheetFiles;
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

  @ApiPropertyOptional({ type: PhotoPrintProfileDto, description: "kind='photo-print' 필수, 그 외 금지(P2-d)" })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotoPrintProfileDto)
  photoPrint?: PhotoPrintProfileDto;

  @ApiProperty({ type: ProductOutputPolicyDto })
  @ValidateNested()
  @Type(() => ProductOutputPolicyDto)
  output: ProductOutputPolicyDto;
}
