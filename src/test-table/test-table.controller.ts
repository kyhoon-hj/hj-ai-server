import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExcludeController,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateTestTableDto } from './dto/create-test-table.dto';
import { UpdateTestTableDto } from './dto/update-test-table.dto';
import { TestTableEntity } from './entities/test-table.entity';
import { TestTableService } from './test-table.service';
import { UseGuards } from '@nestjs/common';
import { ApiExposure } from '../common/guards/api-exposure.decorator';
import { ApiExposureGuard } from '../common/guards/api-exposure.guard';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { AdminRoles } from '../common/guards/admin-roles.decorator';

@ApiTags('test-tables')
@ApiExcludeController()
@ApiExposure('testTable')
@UseGuards(ApiExposureGuard, AdminApiKeyGuard)
@AdminRoles('platform-admin')
@Controller('test-tables')
export class TestTableController {
  constructor(private readonly testTableService: TestTableService) {}

  @Post()
  @ApiCreatedResponse({ type: TestTableEntity })
  create(@Body() dto: CreateTestTableDto) {
    return this.testTableService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: TestTableEntity, isArray: true })
  findAll() {
    return this.testTableService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: TestTableEntity })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.testTableService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: TestTableEntity })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTestTableDto,
  ) {
    return this.testTableService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: TestTableEntity })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.testTableService.remove(id);
  }
}
