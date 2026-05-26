import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from './logger.js';

export type AuditEvent = 'preview' | 'commit' | 'delete_blocked' | 'convert_blocked';

function resolveLogPath(): string {
    const raw = process.env.TOSHL_AUDIT_LOG || '~/.toshl-mcp/audit.log';
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

let logPath: string | null = null;

export function initAuditLog(): void {
    logPath = resolveLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logger.info('Audit log initialized', { path: logPath });
}

export function logAudit(event: AuditEvent, token: string | null, payload: unknown): void {
    if (!logPath) {
        // Fallback: initialise lazily so tests / unexpected paths still log.
        initAuditLog();
    }
    const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        token,
        payload,
    }) + '\n';
    // Synchronous append: we want the record on disk before the op fires.
    fs.appendFileSync(logPath as string, line);
}
