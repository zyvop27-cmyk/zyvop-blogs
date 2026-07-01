import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { DraftJob, DraftJobStatus } from './draft-job.entity';
import { CreateDraftDto } from './dto/create-draft.dto';

export interface DraftJobData {
  draftJobId: string;
  topic: string;
  simulateFailures: number;
}

@Injectable()
export class DraftsService {
  constructor(
    @InjectRepository(DraftJob)
    private readonly draftJobsRepository: Repository<DraftJob>,
    @InjectQueue('draft-generation')
    private readonly draftQueue: Queue<DraftJobData>,
  ) {}

  async enqueue(dto: CreateDraftDto): Promise<{ id: string; status: DraftJobStatus }> {
    const draftJob = await this.draftJobsRepository.save(
      this.draftJobsRepository.create({ topic: dto.topic, status: DraftJobStatus.PENDING }),
    );

    // jobId = draftJob.id: if this row's job ever gets enqueued twice
    // (e.g. a retry in calling code), BullMQ treats the second add() as a
    // no-op rather than creating a duplicate job in the queue.
    await this.draftQueue.add(
      'generate',
      {
        draftJobId: draftJob.id,
        topic: dto.topic,
        simulateFailures: dto.simulateFailures ?? 0,
      },
      {
        jobId: draftJob.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 }, // drop from Redis 1hr after completing
        removeOnFail: { age: 86400 }, // keep failed jobs a day longer, for debugging
      },
    );

    return { id: draftJob.id, status: draftJob.status };
  }

  async findById(id: string): Promise<DraftJob> {
    const draftJob = await this.draftJobsRepository.findOne({ where: { id } });
    if (!draftJob) {
      throw new NotFoundException('Draft job not found');
    }
    return draftJob;
  }

  async markProcessing(id: string): Promise<void> {
    await this.draftJobsRepository.update(id, { status: DraftJobStatus.PROCESSING });
  }

  async markCompleted(id: string, result: string, attemptsMade: number): Promise<void> {
    await this.draftJobsRepository.update(id, {
      status: DraftJobStatus.COMPLETED,
      result,
      attemptsMade,
      completedAt: new Date(),
    });
  }

  async markFailed(id: string, attemptsMade: number, failureReason: string): Promise<void> {
    await this.draftJobsRepository.update(id, {
      status: DraftJobStatus.FAILED,
      attemptsMade,
      failureReason,
    });
  }
}
