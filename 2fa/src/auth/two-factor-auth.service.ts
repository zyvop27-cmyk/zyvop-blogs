import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Secret, TOTP } from 'otpauth';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';

const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_ALGORITHM = 'SHA1';

@Injectable()
export class TwoFactorAuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  private buildTotp(base32Secret: string, email: string): TOTP {
    const appName =
      this.configService.get<string>('TWO_FACTOR_AUTHENTICATION_APP_NAME') ?? 'App';

    return new TOTP({
      issuer: appName,
      label: email,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret: Secret.fromBase32(base32Secret),
    });
  }

  /**
   * Generates a new base32 TOTP secret, stores it (unconfirmed) against the
   * user, and returns a QR code the user can scan with an authenticator app.
   */
  async generateSecret(userId: string, email: string) {
    const secret = new Secret({ size: 20 });
    await this.usersService.setTwoFactorSecret(userId, secret.base32);

    const totp = this.buildTotp(secret.base32, email);
    const otpAuthUrl = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

    return { qrCodeDataUrl, otpAuthUrl };
  }

  /**
   * Validates a 6-digit code against the stored secret, allowing one step
   * (30s) of clock drift in either direction.
   */
  verifyTotpToken(token: string, base32Secret: string, email: string): boolean {
    const totp = this.buildTotp(base32Secret, email);
    const delta = totp.validate({ token, window: 1 });
    return delta !== null;
  }

  /** Generates short, single-use recovery codes (e.g. "a1b2c3d4e5"). */
  generateBackupCodes(count = 8): string[] {
    return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex'));
  }

  async hashBackupCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
  }

  /**
   * Checks `code` against the stored hashed backup codes. On a match, that
   * code is removed from the list so it can't be reused.
   */
  async verifyAndConsumeBackupCode(
    userId: string,
    code: string,
    hashedCodes: string[],
  ): Promise<boolean> {
    for (let i = 0; i < hashedCodes.length; i++) {
      const matches = await bcrypt.compare(code, hashedCodes[i]);
      if (matches) {
        const remaining = [...hashedCodes];
        remaining.splice(i, 1);
        await this.usersService.updateBackupCodes(userId, remaining);
        return true;
      }
    }
    return false;
  }
}
