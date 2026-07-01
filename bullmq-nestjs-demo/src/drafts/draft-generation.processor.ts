import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { generateDraftContent } from './draft-content.generator';
import { DraftsService } from './drafts.service';
import type { DraftJobData } from './drafts.service';

@Processor('draft-generation', { concurrency: 5 })
export class DraftGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(DraftGenerationProcessor.name);

  constructor(private readonly draftsService: DraftsService) {
    super();
  }

  async process(job: Job<DraftJobData>): Promise<string> {
    const { draftJobId, topic, simulateFailures } = job.data;
    this.logger.log(`Processing draft ${draftJobId} (attempt ${job.attemptsMade + 1})`);

    await this.draftsService.markProcessing(draftJobId);

    // Throwing here is what tells BullMQ to retry (subject to the job's
    // `attempts`/`backoff` options) rather than treating it as terminal.
    return generateDraftContent(topic, job.attemptsMade, simulateFailures);
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<DraftJobData>, result: string) {
    await this.draftsService.markCompleted(job.data.draftJobId, result, job.attemptsMade);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<DraftJobData> | undefined, error: Error) {
    if (!job) return;

    // BullMQ fires 'failed' after EVERY failed attempt, not just the last
    // one. Only write a terminal "failed" status once attempts are exhausted —
    // otherwise a job that's about to succeed on retry #3 would get
    // incorrectly marked failed after retry #1.
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.warn(`Draft ${job.data.draftJobId} failed permanently: ${error.message}`);
      await this.draftsService.markFailed(job.data.draftJobId, job.attemptsMade, error.message);
    } else {
      this.logger.warn(
        `Draft ${job.data.draftJobId} failed attempt ${job.attemptsMade}/${maxAttempts}, will retry: ${error.message}`,
      );
    }
  }
}
