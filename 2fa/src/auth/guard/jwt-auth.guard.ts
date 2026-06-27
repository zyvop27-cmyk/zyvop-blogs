import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Accepts any valid, unexpired JWT — including the "partial" token issued
 * right after password login but before a 2FA code has been verified.
 *
 * This should ONLY guard /2fa/authenticate. Every other 2FA-related route
 * (/2fa/generate, /2fa/turn-on, /2fa/turn-off) requires JwtTwoFactorGuard
 * instead — otherwise a partial token obtained with just a stolen password
 * could be used to overwrite an account's TOTP secret and backup codes,
 * silently hijacking 2FA without ever needing the original second factor.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
