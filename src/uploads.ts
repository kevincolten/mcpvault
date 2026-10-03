import { randomBytes } from 'node:crypto';

export interface UploadTicket {
  path: string;
  overwrite: boolean;
  expiresAt: number;
}

const MAX_PENDING = 100;

/**
 * In-memory, single-use upload tickets. The token is the credential for the
 * HTTP upload route, so it is long, random, short-lived and burned on success.
 * A failed upload puts the ticket back so the same link can be retried until
 * it expires.
 */
export class UploadTokenStore {
  private tickets = new Map<string, UploadTicket>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get ttlSeconds(): number {
    return Math.round(this.ttlMs / 1000);
  }

  create(path: string, overwrite = false): { token: string; expiresAt: number } {
    this.sweep();
    if (this.tickets.size >= MAX_PENDING) {
      throw new Error('Too many pending upload links; use or wait out the existing ones');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.ttlMs;
    this.tickets.set(token, { path, overwrite, expiresAt });
    return { token, expiresAt };
  }

  /** Take a ticket out of circulation. Returns undefined if unknown or expired. */
  take(token: string): UploadTicket | undefined {
    const ticket = this.tickets.get(token);
    if (!ticket) return undefined;
    this.tickets.delete(token);
    if (ticket.expiresAt <= this.now()) return undefined;
    return ticket;
  }

  /** Put a ticket back after a failed attempt. */
  restore(token: string, ticket: UploadTicket): void {
    if (ticket.expiresAt > this.now()) this.tickets.set(token, ticket);
  }

  private sweep(): void {
    const now = this.now();
    for (const [token, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(token);
    }
  }
}
