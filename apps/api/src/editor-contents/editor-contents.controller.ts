import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EditorContentsService } from './editor-contents.service';
import { QueryEditorContentDto } from './dto/query-editor-content.dto';
import { UpdateEditorContentDto } from './dto/update-editor-content.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, EditorContentType } from '@storige/types';
import { PartnerOperatorAllowed } from '../auth/decorators/partner-operator-allowed.decorator';

@Controller('editor-contents')
export class EditorContentsController {
  constructor(private readonly editorContentsService: EditorContentsService) {}

  @Get('templates')
  @PartnerOperatorAllowed() // 운영자 대리 편집 편집기 소재 패널(조회 전용, 2026-09-29)
  async getTemplates(@Query() query: QueryEditorContentDto) {
    const result = await this.editorContentsService.getTemplates(query);
    return {
      success: true,
      data: result,
    };
  }

  @Get('frames')
  @PartnerOperatorAllowed() // 운영자 대리 편집 편집기 소재 패널(조회 전용, 2026-09-29)
  async getFrames(@Query() query: QueryEditorContentDto) {
    const result = await this.editorContentsService.getFrames(query);
    return {
      success: true,
      data: result,
    };
  }

  @Get('images')
  @PartnerOperatorAllowed() // 운영자 대리 편집 편집기 소재 패널(조회 전용, 2026-09-29)
  async getImages(@Query() query: QueryEditorContentDto) {
    const result = await this.editorContentsService.getImages(query);
    return {
      success: true,
      data: result,
    };
  }

  @Get('backgrounds')
  @PartnerOperatorAllowed() // 운영자 대리 편집 편집기 소재 패널(조회 전용, 2026-09-29)
  async getBackgrounds(@Query() query: QueryEditorContentDto) {
    const result = await this.editorContentsService.getBackgrounds(query);
    return {
      success: true,
      data: result,
    };
  }

  @Get('elements')
  @PartnerOperatorAllowed() // 운영자 대리 편집 편집기 소재 패널(조회 전용, 2026-09-29)
  async getElements(@Query() query: QueryEditorContentDto) {
    const result = await this.editorContentsService.getElements(query);
    return {
      success: true,
      data: result,
    };
  }

  @Get(':id')
  @PartnerOperatorAllowed() // 운영자 대리 편집 편집기 소재 패널(조회 전용, 2026-09-29)
  async findOne(@Param('id') id: string) {
    const content = await this.editorContentsService.findOne(id);
    return {
      success: true,
      data: content,
    };
  }

  @Put(':type/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(
    @Param('type') type: EditorContentType,
    @Param('id') id: string,
    @Body() dto: UpdateEditorContentDto,
  ) {
    const content = await this.editorContentsService.update(type, id, dto);
    return {
      success: true,
      data: content,
    };
  }
}
