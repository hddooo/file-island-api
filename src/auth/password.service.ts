import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id (OWASP baseline: 19 MiB memory, 2 iterations, 1 lane). Plain passwords are never stored or logged. */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same work as a real verification when the e-mail is unknown (reduces account enumeration by timing). */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= argon2.hash('hanq-dummy-password-for-timing', OPTIONS);
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
