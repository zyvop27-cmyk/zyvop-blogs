import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DraftGenerationProcessor } from './draft-generation.processor';
import { DraftJob } from './draft-job.entity';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DraftJob]),
    BullModule.registerQueue({ name: 'draft-generation' }),
  ],
  controllers: [DraftsController],
  providers: [DraftsService, DraftGenerationProcessor],
})
export class DraftsModule {}
