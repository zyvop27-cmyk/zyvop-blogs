import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface LockStatus {
  locked: boolean;
  retryAfterSeconds?: number;
}

export interface FailureResult {
  attempts: number;
  locked: boolean;
  retryAfterSeconds?: number;
}

/**
 * Tracks failed login attempts PER EMAIL, independent of source IP. This is
 * what stops a distributed or slow-and-low attack against one specific
 * account — @nestjs/throttler's IP-based limiter (see AuthController)
 * doesn't help there, since a distributed attacker never repeats an IP
 * often enough to trip it.
 */
@Injectable()
export class LoginAttemptService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;
  private readonly lockoutSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
    });

    this.maxAttempts = Number(this.configService.get('LOGIN_LOCKOUT_MAX_ATTEMPTS') ?? 5);
    this.windowSeconds = Number(this.configService.get('LOGIN_LOCKOUT_WINDOW_SECONDS') ?? 900);
    this.lockoutSeconds = Number(this.configService.get('LOGIN_LOCKOUT_DURATION_SECONDS') ?? 900);
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  private attemptsKey(email: string): string {
    return `login-attempts:${email.toLowerCase()}`;
  }

  private lockKey(email: string): string {
    return `login-lock:${email.toLowerCase()}`;
  }

  async isLocked(email: string): Promise<LockStatus> {
    const ttl = await this.redis.ttl(this.lockKey(email));
    return ttl > 0 ? { locked: true, retryAfterSeconds: ttl } : { locked: false };
  }

  /**
   * Records a failed attempt and locks the account once `maxAttempts` is
   * reached. The counter's own TTL (`windowSeconds`) is only set on the
   * FIRST failure of a streak — later failures just increment the existing
   * counter, they don't push its expiry back out. That's a deliberate
   * choice: a burst of guesses within one window counts as one streak, not
   * an ever-renewing one.
   */
  async recordFailure(email: string): Promise<FailureResult> {
    const key = this.attemptsKey(email);
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      await this.redis.expire(key, this.windowSeconds);
    }

    if (attempts >= this.maxAttempts) {
      await this.redis.set(this.lockKey(email), '1', 'EX', this.lockoutSeconds);
      return { attempts, locked: true, retryAfterSeconds: this.lockoutSeconds };
    }

    return { attempts, locked: false };
  }

  async recordSuccess(email: string): Promise<void> {
    await this.redis.del(this.attemptsKey(email), this.lockKey(email));
  }
}
