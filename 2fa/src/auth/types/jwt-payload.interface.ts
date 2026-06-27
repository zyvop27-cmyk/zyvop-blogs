import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  /** False right after password login when the account has 2FA enabled. */
  isSecondFactorAuthenticated: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
