import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  // select: false keeps this out of normal queries so it never
  // leaks through a stray `find()` or gets serialized by accident.
  @Column({ select: false })
  password: string;

  @Column({ default: false })
  isTwoFactorEnabled: boolean;

  // Unconfirmed until the user verifies a code via /auth/2fa/turn-on.
  @Column({ type: 'varchar', nullable: true, select: false })
  twoFactorSecret: string | null;

  // Bcrypt-hashed single-use recovery codes. Never store these in plaintext.
  @Column('text', { array: true, nullable: true, select: false })
  twoFactorBackupCodes: string[] | null;
}
