import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 종이 타입 엔티티
 * 책등 폭 계산에 사용되는 종이 종류와 두께 정보를 관리
 */
@Entity('paper_types')
export class PaperTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, unique: true })
  code: string; // 'mojo_70g', 'mojo_80g', 'art_200g' 등

  @Column({ length: 100 })
  name: string; // '모조지 70g', '모조지 80g' 등

  @Column({ type: 'decimal', precision: 5, scale: 3 })
  thickness: number; // mm per sheet (0.09, 0.10, 0.18 등) — v1(legacy) 공식용

  /**
   * R-44 v2 (2026-07-21): 무선(perfect) 공식용 페이지당 두께(mm/페이지).
   * youshindang 두께표 이식값. NULL = v1 전용 지종(legacy 8코드) → v1 공식 유지.
   */
  @Column({ type: 'decimal', precision: 6, scale: 3, nullable: true })
  thicknessPerPageMm: number | null;

  /**
   * R-44 v2: 양장(hardcover) 공식용 장당 두께(mm/장). mybookmake 두께표 이식값.
   * ⚠️ 무선표와 단위가 다름(약 2배) — 공식 분기에서만 사용.
   */
  @Column({ type: 'decimal', precision: 6, scale: 3, nullable: true })
  thicknessPerSheetMm: number | null;

  /**
   * 외부 파트너 라벨 별칭(JSON 배열) — bookmoa productMeta.innerPaper
   * ("아르떼(UW)130"·"모조80" 등)를 code 로 해석하기 위한 흡수층.
   * simple-json 대신 방어적 transformer(F15): 운영자/수동 UPDATE 로 1행이 비-JSON
   * 오염돼도 해당 행만 aliases=null 강등 — 전량 find 를 타는 @Public 계산·잡 주입이
   * 행 하나 때문에 전면 500 나는 사고 차단(code 정확일치·정규화 사다리는 계속 동작).
   */
  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      to: (v: string[] | null | undefined) => (v == null ? null : JSON.stringify(v)),
      from: (v: string | null) => {
        if (v == null) return null;
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      },
    },
  })
  aliases: string[] | null;

  @Column({ length: 20, default: 'body' })
  category: string; // 'body' (본문용) | 'cover' (표지용)

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
