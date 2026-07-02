import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginAttemptService: LoginAttemptService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Two independent layers of protection here:
   *
   * 1. @Throttle — IP-based. Overrides the global default policy for this
   *    route specifically, since login is a more sensitive target than most
   *    endpoints. Stops one source hammering the endpoint at volume.
   *
   * 2. LoginAttemptService — account-based, keyed by email, tracked in
   *    Redis. Stops repeated guessing against ONE account regardless of
   *    which IP (or how many different IPs) the attempts come from — the
   *    kind of attack IP throttling alone doesn't catch.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const lockStatus = await this.loginAttemptService.isLocked(dto.email);
    if (lockStatus.locked) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Account temporarily locked after too many failed attempts. Try again in ${lockStatus.retryAfterSeconds}s.`,
          reason: 'ACCOUNT_LOCKED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const user = await this.authService.validatePassword(dto.email, dto.password);
      await this.loginAttemptService.recordSuccess(dto.email);
      return { accessToken: this.authService.issueToken(user) };
    } catch (err) {
      // Record the failure and rethrow the ORIGINAL error either way — even
      // if this failure was the one that crossed the lockout threshold, this
      // response still reads as a normal "invalid credentials" rejection.
      // The lock only becomes visible on the NEXT attempt, via the isLocked
      // check above. That's deliberate: it doesn't telegraph "this was your
      // last try" to whoever's attempting the login.
      await this.loginAttemptService.recordFailure(dto.email);
      throw err;
    }
  }
}
