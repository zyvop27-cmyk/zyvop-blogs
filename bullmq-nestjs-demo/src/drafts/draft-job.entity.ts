import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum DraftJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * The durable record of a draft-generation request. BullMQ/Redis owns the
 * job's execution state (queued, active, retrying); this table is the
 * source of truth a client actually polls, and what survives if Redis
 * data is ever flushed or a job's history is cleaned up.
 */
@Entity()
export class DraftJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  topic: string;

  @Column({ type: 'varchar', default: DraftJobStatus.PENDING })
  status: DraftJobStatus;

  @Column({ type: 'text', nullable: true })
  result: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ default: 0 })
  attemptsMade: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
