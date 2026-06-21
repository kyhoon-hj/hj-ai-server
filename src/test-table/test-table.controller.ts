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
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreateTestTableDto } from './dto/create-test-table.dto';
import { UpdateTestTableDto } from './dto/update-test-table.dto';
import { TestTableEntity } from './entities/test-table.entity';
import { TestTableService } from './test-table.service';

@ApiTags('test-tables')
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
