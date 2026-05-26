import { randomUUID } from 'crypto';

export type BatchOperation =
    | { action: 'create'; data: Record<string, any> }
    | { action: 'update'; data: Record<string, any> }
    | { action: 'manage'; data: Record<string, any> };

interface BatchRecord {
    operations: BatchOperation[];
    expiresAt: number;
    used: boolean;
}

const TOKEN_TTL_MS = 5 * 60 * 1000;

const store = new Map<string, BatchRecord>();

export function createBatch(operations: BatchOperation[]): { token: string; expiresAt: number } {
    const token = randomUUID();
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    store.set(token, { operations, expiresAt, used: false });
    return { token, expiresAt };
}

export type ClaimResult =
    | { status: 'ok'; operations: BatchOperation[] }
    | { status: 'missing' | 'expired' | 'used' };

export function claimBatch(token: string): ClaimResult {
    const rec = store.get(token);
    if (!rec) return { status: 'missing' };
    if (rec.used) return { status: 'used' };
    if (Date.now() > rec.expiresAt) return { status: 'expired' };
    // Mark used synchronously before we ever touch the API, so retries on
    // network errors cannot replay the same token.
    rec.used = true;
    return { status: 'ok', operations: rec.operations };
}
