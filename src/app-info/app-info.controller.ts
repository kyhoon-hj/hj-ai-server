import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppInfoService } from './app-info.service';
import { CreateAppInfoDto } from './dto/create-app-info.dto';
import { UpdateAppInfoDto } from './dto/update-app-info.dto';
import {
  AppInfoEntity,
  AppInfoPublicEntity,
} from './entities/app-info.entity';

@ApiTags('app-info')
@Controller('app-info')
export class AppInfoController {
  constructor(private readonly appInfoService: AppInfoService) {}

  @Post()
  @ApiCreatedResponse({ type: AppInfoEntity })
  create(@Body() dto: CreateAppInfoDto) {
    return this.appInfoService.create(dto);
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
  @ApiOkResponse({ type: AppInfoEntity })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppInfoDto,
  ) {
    return this.appInfoService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: AppInfoEntity })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.appInfoService.remove(id);
  }
}
