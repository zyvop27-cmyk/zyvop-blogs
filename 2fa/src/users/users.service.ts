import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(email: string, hashedPassword: string): Promise<User> {
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const user = this.usersRepository.create({ email, password: hashedPassword });
    return this.usersRepository.save(user);
  }

  /** Password column is select:false, so it has to be pulled in explicitly. */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  /** Pulls in the 2FA secret + backup codes, which are select:false by default. */
  async findByIdWithSecrets(id: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect(['user.twoFactorSecret', 'user.twoFactorBackupCodes'])
      .where('user.id = :id', { id })
      .getOne();
  }

  async setTwoFactorSecret(id: string, secret: string): Promise<void> {
    await this.usersRepository.update(id, { twoFactorSecret: secret });
  }

  async enableTwoFactor(id: string, hashedBackupCodes: string[]): Promise<void> {
    await this.usersRepository.update(id, {
      isTwoFactorEnabled: true,
      twoFactorBackupCodes: hashedBackupCodes,
    });
  }

  async disableTwoFactor(id: string): Promise<void> {
    await this.usersRepository.update(id, {
      isTwoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    });
  }

  async updateBackupCodes(id: string, hashedBackupCodes: string[]): Promise<void> {
    await this.usersRepository.update(id, { twoFactorBackupCodes: hashedBackupCodes });
  }
}
