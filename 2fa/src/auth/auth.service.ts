import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create(dto.email, hashedPassword);
    return { id: user.id, email: user.email };
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  issueToken(user: User, isSecondFactorAuthenticated: boolean): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      isSecondFactorAuthenticated,
    };

    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRATION_TIME'),
    });
  }

  /**
   * Issues a "partial" token (isSecondFactorAuthenticated: false) if the
   * account has 2FA enabled, or a full token otherwise.
   */
  login(user: User) {
    if (user.isTwoFactorEnabled) {
      return {
        accessToken: this.issueToken(user, false),
        twoFactorRequired: true,
      };
    }

    return {
      accessToken: this.issueToken(user, true),
      twoFactorRequired: false,
    };
  }
}
