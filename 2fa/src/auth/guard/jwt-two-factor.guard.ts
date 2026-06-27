import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedRequest } from '../types/jwt-payload.interface';

/**
 * Requires a JWT where isSecondFactorAuthenticated is true — i.e. the user
 * has either passed their TOTP/backup code, or never had 2FA enabled.
 * Use this on any route that should be off-limits until 2FA is satisfied.
 */
@Injectable()
export class JwtTwoFactorGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = (await super.canActivate(context)) as boolean;
    if (!canActivate) {
      return false;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user.isSecondFactorAuthenticated) {
      throw new UnauthorizedException('Two-factor authentication required');
    }

    return true;
  }
}
