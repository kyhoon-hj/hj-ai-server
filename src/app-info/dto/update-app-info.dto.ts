import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateAppInfoDto } from './create-app-info.dto';

export class UpdateAppInfoDto extends PartialType(
  OmitType(CreateAppInfoDto, ['appkeyTtlDays'] as const),
) {}
