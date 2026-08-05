import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { AppInfoService } from './app-info.service';
import { CreateAppInfoDto } from './dto/create-app-info.dto';
import { UpdateAppInfoDto } from './dto/update-app-info.dto';
import {
  AppInfoCreatedEntity,
  AppInfoPublicEntity,
} from './entities/app-info.entity';

@ApiTags('app-info')
@UseGuards(AdminApiKeyGuard)
@ApiSecurity('adminKey')
@ApiHeader({
  name: 'x-admin-key',
  description: '플랫폼 관리자 전용 credential입니다.',
  required: true,
})
@Controller('app-info')
export class AppInfoController {
  constructor(private readonly appInfoService: AppInfoService) {}

  @Post()
  @ApiCreatedResponse({ type: AppInfoCreatedEntity })
  create(@Body() dto: CreateAppInfoDto) {
    return this.appInfoService.create(dto);
  }

  @Post(':id/appkey')
  @ApiCreatedResponse({ type: AppInfoCreatedEntity })
  rotateAppKey(@Param('id', ParseUUIDPipe) id: string) {
    return this.appInfoService.rotateAppKey(id);
  }

  @Get()
  @ApiOkResponse({ type: AppInfoPublicEntity, isArray: true })
  findAll() {
    return this.appInfoService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: AppInfoPublicEntity })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.appInfoService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: AppInfoPublicEntity })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppInfoDto,
  ) {
    return this.appInfoService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: AppInfoPublicEntity })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.appInfoService.remove(id);
  }
}
