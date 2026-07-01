import { IsInt, IsOptional, IsString, Max, MinLength, Min } from 'class-validator';

export class CreateDraftDto {
  @IsString()
  @MinLength(3)
  topic: string;

  /**
   * Testing/demo knob only — NOT something a real client would send.
   * Forces the worker to fail this many times before succeeding, so the
   * retry/backoff path can be exercised deterministically instead of
   * hoping a real upstream call happens to fail. Defaults to 0 (succeeds
   * on the first attempt, like a normal request would).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  simulateFailures?: number;
}
