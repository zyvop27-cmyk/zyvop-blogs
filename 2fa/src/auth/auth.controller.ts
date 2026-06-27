import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TwoFactorAuthCodeDto } from './dto/two-factor-auth-code.dto';
import { JwtAuthGuard } from './guard/jwt-auth.guard';
import { JwtTwoFactorGuard } from './guard/jwt-two-factor.guard';
import { AuthenticatedRequest } from './types/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    return this.authService.login(user);
  }

  /** Step 1 of enabling 2FA: get a secret + QR code to scan. */
  @UseGuards(JwtTwoFactorGuard)
  @Post('2fa/generate')
  async generate(@Req() req: AuthenticatedRequest) {
    const { qrCodeDataUrl } = await this.twoFactorAuthService.generateSecret(
      req.user.sub,
      req.user.email,
    );
    return { qrCodeDataUrl };
  }

  /** Step 2: prove possession of the authenticator by submitting a live code. */
  @UseGuards(JwtTwoFactorGuard)
  @Post('2fa/turn-on')
  async turnOn(@Req() req: AuthenticatedRequest, @Body() dto: TwoFactorAuthCodeDto) {
    const user = await this.usersService.findByIdWithSecrets(req.user.sub);
    if (!user?.twoFactorSecret) {
      throw new BadRequestException('Call /auth/2fa/generate first');
    }

    const isValid = this.twoFactorAuthService.verifyTotpToken(
      dto.twoFactorAuthCode,
      user.twoFactorSecret,
      user.email,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid authenticator code');
    }

    const backupCodes = this.twoFactorAuthService.generateBackupCodes();
    const hashedBackupCodes = await this.twoFactorAuthService.hashBackupCodes(backupCodes);
    await this.usersService.enableTwoFactor(user.id, hashedBackupCodes);

    return {
      message: '2FA enabled. Store these backup codes safely — they will not be shown again.',
      backupCodes,
    };
  }

  @UseGuards(JwtTwoFactorGuard)
  @Post('2fa/turn-off')
  async turnOff(@Req() req: AuthenticatedRequest, @Body() dto: TwoFactorAuthCodeDto) {
    const user = await this.usersService.findByIdWithSecrets(req.user.sub);
    if (!user?.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const isValid = this.twoFactorAuthService.verifyTotpToken(
      dto.twoFactorAuthCode,
      user.twoFactorSecret,
      user.email,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid authenticator code');
    }

    await this.usersService.disableTwoFactor(user.id);
    return { message: '2FA disabled' };
  }

  /** Exchanges a partial token + TOTP/backup code for a full access token. */
  @UseGuards(JwtAuthGuard)
  @Post('2fa/authenticate')
  async authenticate(@Req() req: AuthenticatedRequest, @Body() dto: TwoFactorAuthCodeDto) {
    const user = await this.usersService.findByIdWithSecrets(req.user.sub);
    if (!user?.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled for this account');
    }

    let isValid = this.twoFactorAuthService.verifyTotpToken(
      dto.twoFactorAuthCode,
      user.twoFactorSecret,
      user.email,
    );

    if (!isValid && user.twoFactorBackupCodes?.length) {
      isValid = await this.twoFactorAuthService.verifyAndConsumeBackupCode(
        user.id,
        dto.twoFactorAuthCode,
        user.twoFactorBackupCodes,
      );
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid authentication code');
    }

    return { accessToken: this.authService.issueToken(user, true) };
  }

  /** Example protected route — only reachable once 2FA has been satisfied. */
  @UseGuards(JwtTwoFactorGuard)
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { id: req.user.sub, email: req.user.email };
  }
}
