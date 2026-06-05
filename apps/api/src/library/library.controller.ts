import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LibraryService } from './library.service';
import {
  Woff2ToTtfDto,
  CreateFontDto,
  UpdateFontDto,
  CreateBackgroundDto,
  UpdateBackgroundDto,
  CreateClipartDto,
  UpdateClipartDto,
  CreateShapeDto,
  UpdateShapeDto,
  CreateFrameDto,
  UpdateFrameDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  LibraryCategoryType,
} from './dto/library.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@storige/types';

@ApiTags('Library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  // ============================================================================
  // Fonts
  // ============================================================================

  @Get('fonts')
  @Public()
  @ApiOperation({ summary: 'Get all fonts' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Fonts retrieved successfully' })
  findAllFonts(@Query('isActive') isActive?: boolean) {
    return this.libraryService.findAllFonts(isActive);
  }

  @Get('fonts/:id')
  @ApiOperation({ summary: 'Get font by ID' })
  @ApiResponse({ status: 200, description: 'Font found' })
  @ApiResponse({ status: 404, description: 'Font not found' })
  findOneFont(@Param('id') id: string) {
    return this.libraryService.findOneFont(id);
  }

  @Post('fonts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Upload a new font' })
  @ApiResponse({ status: 201, description: 'Font created successfully' })
  createFont(@Body() createFontDto: CreateFontDto) {
    return this.libraryService.createFont(createFontDto);
  }

  @Patch('fonts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update font' })
  @ApiResponse({ status: 200, description: 'Font updated successfully' })
  updateFont(@Param('id') id: string, @Body() updateFontDto: UpdateFontDto) {
    return this.libraryService.updateFont(id, updateFontDto);
  }

  @Delete('fonts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete font' })
  @ApiResponse({ status: 200, description: 'Font deleted successfully' })
  removeFont(@Param('id') id: string) {
    return this.libraryService.removeFont(id);
  }

  @Post('woff2ToTtf')
  @Public()
  @Header('Content-Type', 'application/octet-stream')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @ApiOperation({
    summary: 'Decompress a WOFF2 font into TTF',
    description:
      'opentype.js (client-side) cannot read WOFF2, so the editor calls this to get a TTF buffer for glyph validation and text→path vectorization. The source host must be allow-listed (SSRF protection).',
  })
  @ApiResponse({ status: 200, description: 'TTF bytes (application/octet-stream)' })
  @ApiResponse({ status: 400, description: 'Invalid or disallowed woff2Url' })
  async woff2ToTtf(@Body() dto: Woff2ToTtfDto): Promise<Buffer> {
    return this.libraryService.woff2ToTtf(dto.woff2Url);
  }

  // ============================================================================
  // Backgrounds
  // ============================================================================

  @Get('backgrounds')
  @ApiOperation({ summary: 'Get all backgrounds' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Backgrounds retrieved successfully' })
  findAllBackgrounds(
    @Query('category') category?: string,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.libraryService.findAllBackgrounds(category, isActive);
  }

  @Get('backgrounds/:id')
  @ApiOperation({ summary: 'Get background by ID' })
  @ApiResponse({ status: 200, description: 'Background found' })
  @ApiResponse({ status: 404, description: 'Background not found' })
  findOneBackground(@Param('id') id: string) {
    return this.libraryService.findOneBackground(id);
  }

  @Post('backgrounds')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Upload a new background' })
  @ApiResponse({ status: 201, description: 'Background created successfully' })
  createBackground(@Body() createBackgroundDto: CreateBackgroundDto) {
    return this.libraryService.createBackground(createBackgroundDto);
  }

  @Patch('backgrounds/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update background' })
  @ApiResponse({ status: 200, description: 'Background updated successfully' })
  updateBackground(@Param('id') id: string, @Body() updateBackgroundDto: UpdateBackgroundDto) {
    return this.libraryService.updateBackground(id, updateBackgroundDto);
  }

  @Delete('backgrounds/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete background' })
  @ApiResponse({ status: 200, description: 'Background deleted successfully' })
  removeBackground(@Param('id') id: string) {
    return this.libraryService.removeBackground(id);
  }

  // ============================================================================
  // Cliparts
  // ============================================================================

  @Get('cliparts')
  @ApiOperation({ summary: 'Get all cliparts' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Cliparts retrieved successfully' })
  findAllCliparts(
    @Query('category') category?: string,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.libraryService.findAllCliparts(category, isActive);
  }

  @Get('cliparts/search')
  @ApiOperation({ summary: 'Search cliparts by tags' })
  @ApiQuery({ name: 'tags', required: true, type: [String] })
  @ApiResponse({ status: 200, description: 'Cliparts found' })
  searchClipartsByTags(@Query('tags') tags: string | string[]) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    return this.libraryService.searchClipartsByTags(tagArray);
  }

  @Get('cliparts/:id')
  @ApiOperation({ summary: 'Get clipart by ID' })
  @ApiResponse({ status: 200, description: 'Clipart found' })
  @ApiResponse({ status: 404, description: 'Clipart not found' })
  findOneClipart(@Param('id') id: string) {
    return this.libraryService.findOneClipart(id);
  }

  @Post('cliparts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Upload a new clipart' })
  @ApiResponse({ status: 201, description: 'Clipart created successfully' })
  createClipart(@Body() createClipartDto: CreateClipartDto) {
    return this.libraryService.createClipart(createClipartDto);
  }

  @Patch('cliparts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update clipart' })
  @ApiResponse({ status: 200, description: 'Clipart updated successfully' })
  updateClipart(@Param('id') id: string, @Body() updateClipartDto: UpdateClipartDto) {
    return this.libraryService.updateClipart(id, updateClipartDto);
  }

  @Delete('cliparts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete clipart' })
  @ApiResponse({ status: 200, description: 'Clipart deleted successfully' })
  removeClipart(@Param('id') id: string) {
    return this.libraryService.removeClipart(id);
  }

  // ============================================================================
  // Shapes
  // ============================================================================

  @Get('shapes')
  @ApiOperation({ summary: 'Get all shapes' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Shapes retrieved successfully' })
  findAllShapes(
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.libraryService.findAllShapes(categoryId, isActive);
  }

  @Get('shapes/:id')
  @ApiOperation({ summary: 'Get shape by ID' })
  @ApiResponse({ status: 200, description: 'Shape found' })
  @ApiResponse({ status: 404, description: 'Shape not found' })
  findOneShape(@Param('id') id: string) {
    return this.libraryService.findOneShape(id);
  }

  @Post('shapes')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new shape' })
  @ApiResponse({ status: 201, description: 'Shape created successfully' })
  createShape(@Body() createShapeDto: CreateShapeDto) {
    return this.libraryService.createShape(createShapeDto);
  }

  @Patch('shapes/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update shape' })
  @ApiResponse({ status: 200, description: 'Shape updated successfully' })
  updateShape(@Param('id') id: string, @Body() updateShapeDto: UpdateShapeDto) {
    return this.libraryService.updateShape(id, updateShapeDto);
  }

  @Delete('shapes/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete shape' })
  @ApiResponse({ status: 200, description: 'Shape deleted successfully' })
  removeShape(@Param('id') id: string) {
    return this.libraryService.removeShape(id);
  }

  // ============================================================================
  // Frames
  // ============================================================================

  @Get('frames')
  @ApiOperation({ summary: 'Get all frames' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Frames retrieved successfully' })
  findAllFrames(
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.libraryService.findAllFrames(categoryId, isActive);
  }

  @Get('frames/:id')
  @ApiOperation({ summary: 'Get frame by ID' })
  @ApiResponse({ status: 200, description: 'Frame found' })
  @ApiResponse({ status: 404, description: 'Frame not found' })
  findOneFrame(@Param('id') id: string) {
    return this.libraryService.findOneFrame(id);
  }

  @Post('frames')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new frame' })
  @ApiResponse({ status: 201, description: 'Frame created successfully' })
  createFrame(@Body() createFrameDto: CreateFrameDto) {
    return this.libraryService.createFrame(createFrameDto);
  }

  @Patch('frames/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update frame' })
  @ApiResponse({ status: 200, description: 'Frame updated successfully' })
  updateFrame(@Param('id') id: string, @Body() updateFrameDto: UpdateFrameDto) {
    return this.libraryService.updateFrame(id, updateFrameDto);
  }

  @Delete('frames/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete frame' })
  @ApiResponse({ status: 200, description: 'Frame deleted successfully' })
  removeFrame(@Param('id') id: string) {
    return this.libraryService.removeFrame(id);
  }

  // ============================================================================
  // Categories
  // ============================================================================

  @Get('categories')
  @ApiOperation({ summary: 'Get all categories' })
  @ApiQuery({ name: 'type', required: false, enum: ['background', 'shape', 'frame', 'clipart'] })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Categories retrieved successfully' })
  findAllCategories(
    @Query('type') type?: LibraryCategoryType,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.libraryService.findAllCategories(type, isActive);
  }

  @Get('categories/tree/:type')
  @ApiOperation({ summary: 'Get categories as tree structure' })
  @ApiResponse({ status: 200, description: 'Categories tree retrieved successfully' })
  findCategoriesTree(@Param('type') type: LibraryCategoryType) {
    return this.libraryService.findCategoriesTree(type);
  }

  @Get('categories/:id')
  @ApiOperation({ summary: 'Get category by ID' })
  @ApiResponse({ status: 200, description: 'Category found' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  findOneCategory(@Param('id') id: string) {
    return this.libraryService.findOneCategory(id);
  }

  @Post('categories')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new category' })
  @ApiResponse({ status: 201, description: 'Category created successfully' })
  createCategory(@Body() createCategoryDto: CreateCategoryDto) {
    return this.libraryService.createCategory(createCategoryDto);
  }

  @Patch('categories/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update category' })
  @ApiResponse({ status: 200, description: 'Category updated successfully' })
  updateCategory(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    return this.libraryService.updateCategory(id, updateCategoryDto);
  }

  @Delete('categories/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete category' })
  @ApiResponse({ status: 200, description: 'Category deleted successfully' })
  removeCategory(@Param('id') id: string) {
    return this.libraryService.removeCategory(id);
  }
}
