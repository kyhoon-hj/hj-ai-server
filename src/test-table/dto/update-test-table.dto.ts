import { PartialType } from '@nestjs/swagger';
import { CreateTestTableDto } from './create-test-table.dto';

export class UpdateTestTableDto extends PartialType(CreateTestTableDto) {}
