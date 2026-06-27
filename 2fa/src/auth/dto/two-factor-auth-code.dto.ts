import { IsString, Length } from 'class-validator';

/**
 * Accepts either a 6-digit TOTP code or a 10-character backup code,
 * so the same DTO covers /2fa/turn-on, /2fa/turn-off, and /2fa/authenticate.
 */
export class TwoFactorAuthCodeDto {
  @IsString()
  @Length(6, 10)
  twoFactorAuthCode: string;
}
