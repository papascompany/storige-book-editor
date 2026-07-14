import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../auth/entities/user.entity';
import { PaperTypeEntity } from '../../products/entities/paper-type.entity';
import { BindingTypeEntity } from '../../products/entities/binding-type.entity';
import { FormatPreset } from '../../templates/entities/format-preset.entity';
import { AdminSeedService } from './admin-seed.service';
import { SpineSeedService } from './spine-seed.service';
import { FormatPresetSeedService } from './format-preset-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      PaperTypeEntity,
      BindingTypeEntity,
      FormatPreset,
    ]),
  ],
  providers: [AdminSeedService, SpineSeedService, FormatPresetSeedService],
  exports: [AdminSeedService, SpineSeedService, FormatPresetSeedService],
})
export class SeedModule {}
