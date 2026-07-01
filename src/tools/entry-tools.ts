import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createEntriesClient } from '../api/endpoints/entries.js';
import logger from '../utils/logger.js';
import { isDeleteAllowed } from '../utils/safety.js';
import { logAudit } from '../utils/audit-log.js';
import { createBatch, claimBatch, BatchOperation } from '../utils/batch-store.js';
import { getTransferCategoryId } from '../utils/transfer-category.js';
import { getReconciliationCategoryId } from '../utils/reconciliation-category.js';

/* ------------------------------------------------------------------------- */
/* Tool schemas                                                              */
/* ------------------------------------------------------------------------- */

const entryCreateDataSchema = {
    type: 'object',
    properties: {
        amount: {
            type: 'number',
            description: 'Entry amount (negative for expense, positive for income)',
        },
        currency: {
            type: 'object',
            description: 'Currency object',
            properties: {
                code: { type: 'string', description: 'Currency code (e.g., USD, EUR)' },
                rate: { type: 'number', description: 'Exchange rate' },
                fixed: { type: 'boolean', description: 'Whether the exchange rate is fixed' },
            },
            required: ['code'],
        },
        date: { type: 'string', description: 'Entry date (YYYY-MM-DD)' },
        desc: { type: 'string', description: 'Entry description' },
        account: { type: 'string', description: 'Account ID' },
        category: { type: 'string', description: 'Category ID' },
        tags: { type: 'array', description: 'Array of tag IDs', items: { type: 'string' } },
        transaction: {
            type: 'object',
            description: 'Transaction object for transfers between accounts',
            properties: {
                account: { type: 'string' },
                currency: {
                    type: 'object',
                    properties: { code: { type: 'string' } },
                    required: ['code'],
                },
            },
            required: ['account', 'currency'],
        },
    },
    required: ['amount', 'currency', 'date', 'account', 'category'],
};

const entryUpdateDataSchema = {
    type: 'object',
    properties: {
        id: { type: 'string', description: 'Entry ID' },
        amount: { type: 'number' },
        currency: {
            type: 'object',
            properties: {
                code: { type: 'string' },
                rate: { type: 'number' },
                fixed: { type: 'boolean' },
            },
            required: ['code'],
        },
        date: { type: 'string' },
        desc: { type: 'string' },
        account: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        updateMode: { type: 'string', enum: ['all', 'one', 'tail'] },
    },
    required: ['id'],
};

const entryManageDataSchema = {
    type: 'object',
    properties: {
        with: {
            type: 'object',
            properties: {
                tags: { type: 'array', items: { type: 'string' } },
                accounts: { type: 'array', items: { type: 'string' } },
                categories: { type: 'array', items: { type: 'string' } },
                description: { type: 'string' },
            },
        },
        set: {
            type: 'object',
            properties: {
                tags: { type: 'array', items: { type: 'string' } },
                account: { type: 'string' },
                category: { type: 'string' },
            },
        },
        add: {
            type: 'object',
            properties: { tags: { type: 'array', items: { type: 'string' } } },
        },
        remove: {
            type: 'object',
            properties: { tags: { type: 'array', items: { type: 'string' } } },
        },
    },
    required: ['with'],
};

const entrySplitDataSchema = {
    type: 'object',
    properties: {
        id: {
            type: 'string',
            description: 'ID of the original expense entry to split',
        },
        friend_account: {
            type: 'string',
            description:
                "Friend's tracking account ID. The friend's share will be created as a transfer entry from the original entry's account to this account.",
        },
        share_amount: {
            type: 'number',
            description:
                "Friend's portion as an absolute positive number, in the original entry's currency. Mutually exclusive with `equal`.",
        },
        equal: {
            type: 'boolean',
            description:
                'If true, split 50/50 between the user and the friend. Mutually exclusive with `share_amount`.',
        },
        transfer_desc: {
            type: 'string',
            description:
                "Optional description for the generated transfer entry. Defaults to the original entry's desc.",
        },
    },
    required: ['id', 'friend_account'],
    oneOf: [{ required: ['share_amount'] }, { required: ['equal'] }],
};

/**
 * Sets up entry tools. The set of tools depends on runtime config:
 *   - entry_delete is only listed when TOSHL_ALLOW_DELETE=true.
 *   - entry_convert_to_transfer is only listed when TOSHL_ALLOW_DELETE=true
 *     (the conversion deletes the original entry).
 *   - entry_create / entry_update / entry_manage are never listed directly;
 *     callers go through entry_batch_preview + entry_batch_commit.
 */
export function setupEntryTools() {
    const deleteAllowed = isDeleteAllowed();

    const tools: any[] = [
        {
            name: 'entry_list',
            description: 'List entries in Toshl Finance',
            inputSchema: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
                    to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
                    type: { type: 'string', description: 'Entry type (expense, income, transaction)' },
                    accounts: { type: 'string', description: 'Comma-separated account IDs' },
                    categories: { type: 'string', description: 'Comma-separated category IDs' },
                    tags: { type: 'string', description: 'Comma-separated tag IDs' },
                    search: { type: 'string', description: 'Search term' },
                },
                required: ['from', 'to'],
            },
        },
        {
            name: 'entry_get',
            description: 'Get details of a specific entry in Toshl Finance',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string', description: 'Entry ID' } },
                required: ['id'],
            },
        },
        {
            name: 'entry_sums',
            description: 'Get daily sums of entries in Toshl Finance',
            inputSchema: {
                type: 'object',
                properties: {
                    from: { type: 'string' },
                    to: { type: 'string' },
                    currency: { type: 'string' },
                    accounts: { type: 'string' },
                    categories: { type: 'string' },
                    tags: { type: 'string' },
                    range: { type: 'string' },
                    type: { type: 'string' },
                },
                required: ['from', 'to', 'currency'],
            },
        },
        {
            name: 'entry_timeline',
            description: 'Get timeline of entries in Toshl Finance',
            inputSchema: {
                type: 'object',
                properties: {
                    from: { type: 'string' },
                    to: { type: 'string' },
                    accounts: { type: 'string' },
                    categories: { type: 'string' },
                    tags: { type: 'string' },
                },
                required: ['from', 'to'],
            },
        },
        {
            name: 'entry_batch_preview',
            description:
                'Preview a batch of write operations (create / update / manage / split). ' +
                'Validates every operation, returns a confirmation token valid for 5 minutes, ' +
                'and does NOT call the Toshl API. Use entry_batch_commit with the returned token to execute.',
            inputSchema: {
                type: 'object',
                properties: {
                    operations: {
                        type: 'array',
                        description:
                            'List of write operations. Each item is { action: "create"|"update"|"manage"|"split", data: {...} }. ' +
                            'For "create", data matches entry-create shape (amount, currency, date, account, category, ...). ' +
                            'For "update", data must include id plus the fields to change. ' +
                            'For "manage", data matches the bulk-management shape (with, set, add, remove). ' +
                            'For "split", data is { id, friend_account, share_amount|equal, transfer_desc? } — reduces the original expense to the user\'s portion and creates a transfer for the friend\'s share. ' +
                            'NOTE: Toshl\'s system Reconciliation category is not writable via the public API — attempts to attach it via create/update are rejected at preview. Balance-correction on a custom account is app-only.',
                        items: {
                            type: 'object',
                            properties: {
                                action: { type: 'string', enum: ['create', 'update', 'manage', 'split'] },
                                data: { type: 'object' },
                            },
                            required: ['action', 'data'],
                        },
                        minItems: 1,
                    },
                },
                required: ['operations'],
            },
        },
        {
            name: 'entry_batch_commit',
            description:
                'Execute a previously-previewed batch of operations ATOMICALLY. ' +
                'Requires the confirmation_token returned by entry_batch_preview. ' +
                'Operations run sequentially and STOP on the first failure — ' +
                'the response reports which ops committed, which one failed, and which never ran. ' +
                'No auto-rollback: earlier successful ops stay applied and must be reversed manually if needed.',
            inputSchema: {
                type: 'object',
                properties: {
                    confirmation_token: {
                        type: 'string',
                        description: 'UUID returned by entry_batch_preview.',
                    },
                },
                required: ['confirmation_token'],
            },
        },
    ];

    if (deleteAllowed) {
        tools.push({
            name: 'entry_delete',
            description: 'Delete an entry in Toshl Finance',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Entry ID' },
                    deleteMode: {
                        type: 'string',
                        description: 'Delete mode for repeating entries (all, one, tail)',
                        enum: ['all', 'one', 'tail'],
                    },
                },
                required: ['id'],
            },
        });
        tools.push({
            name: 'entry_convert_to_transfer',
            description: 'Convert a regular entry to a transfer between accounts in Toshl Finance',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'ID of the entry to convert' },
                    destination_account: {
                        type: 'string',
                        description: 'Destination account ID for the transfer',
                    },
                    description: {
                        type: 'string',
                        description: 'Optional description for the transfer',
                    },
                },
                required: ['id', 'destination_account'],
            },
        });
    }

    // Reference unused schemas so tree-shakers / linters don't trim them —
    // they are intentionally defined for documentation of the data shapes
    // even though batch-preview's input schema is permissive (type: object).
    void entryCreateDataSchema;
    void entryUpdateDataSchema;
    void entryManageDataSchema;
    void entrySplitDataSchema;

    return tools;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function errorResponse(message: string) {
    return {
        content: [{ type: 'text', text: message }],
        isError: true,
    };
}

function textResponse(body: unknown) {
    return {
        content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    };
}

/* ------------------------------------------------------------------------- */
/* Read-only tool handlers                                                   */
/* ------------------------------------------------------------------------- */

export async function handleEntryListTool(args: any) {
    logger.debug('Handling entry_list tool', { args });
    if (!args?.from || !args?.to) {
        return errorResponse('Missing required parameters: from and to dates');
    }
    try {
        const entriesClient = await createEntriesClient();
        const entries = await entriesClient.listEntries(args);
        return textResponse(entries);
    } catch (error) {
        logger.error('Error handling entry_list tool', { args, error });
        return errorResponse(`Error listing entries: ${(error as Error).message}`);
    }
}

export async function handleEntryGetTool(args: { id: string }) {
    logger.debug('Handling entry_get tool', { args });
    if (!args?.id) return errorResponse('Missing required parameter: id');
    try {
        const entriesClient = await createEntriesClient();
        const entry = await entriesClient.getEntry(args.id);
        return textResponse(entry);
    } catch (error) {
        logger.error('Error handling entry_get tool', { args, error });
        return errorResponse(`Error getting entry: ${(error as Error).message}`);
    }
}

export async function handleEntrySumsTool(args: any) {
    logger.debug('Handling entry_sums tool', { args });
    if (!args?.from || !args?.to || !args?.currency) {
        return errorResponse('Missing required parameters: from, to, and currency');
    }
    try {
        const entriesClient = await createEntriesClient();
        const sums = await entriesClient.getEntrySums(args);
        return textResponse(sums);
    } catch (error) {
        logger.error('Error handling entry_sums tool', { args, error });
        return errorResponse(`Error getting entry sums: ${(error as Error).message}`);
    }
}

export async function handleEntryTimelineTool(args: any) {
    logger.debug('Handling entry_timeline tool', { args });
    if (!args?.from || !args?.to) {
        return errorResponse('Missing required parameters: from and to dates');
    }
    try {
        const entriesClient = await createEntriesClient();
        const timeline = await entriesClient.getEntryTimeline(args);
        return textResponse(timeline);
    } catch (error) {
        logger.error('Error handling entry_timeline tool', { args, error });
        return errorResponse(`Error getting entry timeline: ${(error as Error).message}`);
    }
}

/* ------------------------------------------------------------------------- */
/* Per-op validation                                                         */
/* ------------------------------------------------------------------------- */

const RECONCILE_HINT =
    'category is the system Reconciliation category, which Toshl does not expose for writes via the public API. ' +
    'There is no reconcile action — the balancing-plug workaround is a normal entry in one of your own categories ' +
    '(e.g. Unrealized P&L) sized so the account balance matches the target after Toshl recalculates.';

async function isReconciliationCategory(category: unknown): Promise<boolean> {
    if (typeof category !== 'string' || category.length === 0) return false;
    if (/^reconc/i.test(category)) return true;
    try {
        const reconcileId = await getReconciliationCategoryId();
        if (reconcileId && category === reconcileId) return true;
    } catch (e) {
        // Category lookup failed — degrade gracefully. Commit-time attempts to
        // write the reconciliation category will still fail with 400/403.
        logger.debug('Reconciliation category lookup failed during preview', {
            error: (e as Error).message,
        });
    }
    return false;
}

async function validateCreateData(data: any): Promise<string | null> {
    if (!data || typeof data !== 'object') return 'data must be an object';
    if (typeof data.amount !== 'number') return 'amount must be a number';
    if (!data.currency || typeof data.currency !== 'object') return 'currency is required';
    if (!data.currency.code) return 'currency.code is required';
    if (typeof data.currency.rate !== 'undefined' && typeof data.currency.rate !== 'number') {
        return 'currency.rate must be a number';
    }
    if (!data.date) return 'date is required';
    if (!data.account) return 'account is required';
    if (!data.category) return 'category is required';
    if (await isReconciliationCategory(data.category)) return RECONCILE_HINT;
    return null;
}

async function validateUpdateData(data: any): Promise<string | null> {
    if (!data || typeof data !== 'object') return 'data must be an object';
    if (!data.id) return 'id is required';
    if (typeof data.amount !== 'undefined' && typeof data.amount !== 'number') {
        return 'amount must be a number if provided';
    }
    if (
        typeof data.currency !== 'undefined' &&
        typeof data.currency?.rate !== 'undefined' &&
        typeof data.currency.rate !== 'number'
    ) {
        return 'currency.rate must be a number if provided';
    }
    if (data.category !== undefined && (await isReconciliationCategory(data.category))) {
        return RECONCILE_HINT;
    }
    return null;
}


function validateManageData(data: any): string | null {
    if (!data || typeof data !== 'object') return 'data must be an object';
    if (!data.with) return 'with is required';
    if (!data.with.tags && !data.with.accounts && !data.with.categories && !data.with.description) {
        return 'with must include at least one of: tags, accounts, categories, description';
    }
    if (!data.set && !data.add && !data.remove) {
        return 'at least one of set, add, remove is required';
    }
    return null;
}

function validateSplitData(data: any): string | null {
    if (!data || typeof data !== 'object') return 'data must be an object';
    if (typeof data.id !== 'string' || data.id.length === 0) return 'id is required';
    if (typeof data.friend_account !== 'string' || data.friend_account.length === 0) {
        return 'friend_account is required';
    }
    const hasShare = data.share_amount !== undefined;
    const hasEqual = data.equal !== undefined;
    if (hasShare === hasEqual) {
        return 'exactly one of share_amount or equal must be set';
    }
    if (hasShare) {
        if (typeof data.share_amount !== 'number' || !Number.isFinite(data.share_amount)) {
            return 'share_amount must be a finite number';
        }
        if (data.share_amount <= 0) {
            return 'share_amount must be a positive number (sign is taken from the original entry)';
        }
    }
    if (hasEqual && data.equal !== true) {
        return 'equal must be the boolean literal true (omit the field for non-equal splits)';
    }
    if (data.transfer_desc !== undefined && typeof data.transfer_desc !== 'string') {
        return 'transfer_desc must be a string if provided';
    }
    return null;
}

/* ------------------------------------------------------------------------- */
/* Per-op execution                                                          */
/* ------------------------------------------------------------------------- */

type OpOutcome =
    | { success: true; result: any }
    | { success: false; error: string };

async function execCreate(data: any): Promise<OpOutcome> {
    try {
        const client = await createEntriesClient();
        const entry = await client.createEntry(data);
        return { success: true, result: entry };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

async function execUpdate(data: any): Promise<OpOutcome> {
    try {
        const client = await createEntriesClient();
        const { id, updateMode, ...rest } = data;
        const entry = await client.updateEntry(id, rest, updateMode);
        return { success: true, result: entry };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

async function execManage(data: any): Promise<OpOutcome> {
    try {
        const client = await createEntriesClient();
        await client.manageEntries(data);
        return { success: true, result: { ok: true } };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

/**
 * Split an existing expense entry.
 *
 * Ordering matches `entry_convert_to_transfer`: create the new transfer first,
 * then mutate the original. A failed create leaves the original entry untouched
 * (safe to retry). The audit record is written *between* create and update so
 * the transfer id is durable on disk before we touch the original — that gives
 * the user a recovery handle if the subsequent update fails.
 */
async function execSplit(data: any, token: string): Promise<OpOutcome> {
    const client = await createEntriesClient();

    // 1. Fetch original.
    let original: any;
    try {
        original = await client.getEntry(data.id);
    } catch (e) {
        return { success: false, error: `entry ${data.id} not found: ${(e as Error).message}` };
    }

    // 2. Runtime invariants.
    if (original.transaction !== undefined && original.transaction !== null) {
        return {
            success: false,
            error: `entry ${data.id} is already a transfer; splits operate on regular expense entries`,
        };
    }
    if (typeof original.amount !== 'number') {
        return { success: false, error: `entry ${data.id} has no numeric amount` };
    }
    if (original.amount >= 0) {
        return {
            success: false,
            error: `entry ${data.id} is not an expense (amount is ${original.amount}); split is only defined for expenses (negative amounts)`,
        };
    }

    const round2 = (x: number) => Math.round(x * 100) / 100;
    const absOriginal = Math.abs(original.amount);
    const absShare = data.equal ? round2(absOriginal / 2) : round2(data.share_amount);

    if (!(absShare > 0 && absShare < absOriginal)) {
        return {
            success: false,
            error: `share (${absShare}) must be greater than 0 and strictly less than the original amount (${absOriginal})`,
        };
    }

    const shareSigned = -absShare;
    const retainedSigned = round2(original.amount - shareSigned);

    // 3. Resolve transfer category.
    let transferCategoryId: string | null;
    try {
        transferCategoryId = await getTransferCategoryId();
    } catch (e) {
        return {
            success: false,
            error: `failed to look up transfer category: ${(e as Error).message}`,
        };
    }
    if (!transferCategoryId) {
        return {
            success: false,
            error:
                'No Transfer category resolved. Toshl categories have type expense|income|system; ' +
                'the source-side Transfer category typically has type=expense and name="Transfer". ' +
                'Use category_list to find your Transfer (expense) category, then set ' +
                'TOSHL_TRANSFER_CATEGORY_ID=<that id> and restart the MCP server.',
        };
    }

    // 4. Build and create the transfer entry.
    //
    // Tags are intentionally NOT propagated from the original. User tags in
    // Toshl are scoped to user (expense/income) categories; attaching them to
    // an entry whose category is the system Transfer category causes the API
    // to reject the create with 400. The retained portion of the original
    // keeps its tags untouched (updateEntry only sends { amount }).
    const transferPayload: any = {
        amount: shareSigned,
        currency: original.currency,
        date: original.date,
        desc: data.transfer_desc ?? original.desc,
        account: original.account,
        category: transferCategoryId,
        transaction: {
            account: data.friend_account,
            currency: original.currency,
        },
    };

    let transfer: any;
    try {
        transfer = await client.createEntry(transferPayload);
    } catch (e) {
        return {
            success: false,
            error: `failed to create transfer entry: ${(e as Error).message}`,
        };
    }

    // 5. Audit the split *before* mutating the original, so the transfer id is
    //    durable on disk even if the subsequent update fails.
    logAudit('commit', token, {
        sub: 'split',
        original_id: data.id,
        original_amount_pre: original.amount,
        retained_amount: retainedSigned,
        transfer_id: transfer.id,
        transfer_amount: shareSigned,
        friend_account: data.friend_account,
    });

    // 6. Reduce the original entry's amount.
    try {
        await client.updateEntry(data.id, { amount: retainedSigned });
    } catch (e) {
        return {
            success: false,
            error:
                `transfer ${transfer.id} was created (amount ${shareSigned}) but the original entry ${data.id} could not be updated: ${(e as Error).message}. ` +
                `Recover by manually setting entry ${data.id} amount to ${retainedSigned}, or by deleting transfer ${transfer.id}.`,
        };
    }

    return {
        success: true,
        result: {
            original_id: data.id,
            retained_amount: retainedSigned,
            transfer_id: transfer.id,
            transfer_amount: shareSigned,
        },
    };
}

/* ------------------------------------------------------------------------- */
/* Batch preview / commit                                                    */
/* ------------------------------------------------------------------------- */

function summarize(ops: BatchOperation[]): string {
    const counts: Record<string, number> = {};
    for (const op of ops) counts[op.action] = (counts[op.action] || 0) + 1;
    return Object.entries(counts)
        .map(([a, n]) => `${n} ${a}${n === 1 ? '' : 's'}`)
        .join(', ');
}

export async function handleEntryBatchPreview(args: any) {
    logger.debug('Handling entry_batch_preview tool', { args });

    if (!args || !Array.isArray(args.operations) || args.operations.length === 0) {
        logAudit('preview', null, {
            status: 'validation_failed',
            error: 'operations must be a non-empty array',
            attempted: args,
        });
        return errorResponse('operations must be a non-empty array');
    }

    const normalized: BatchOperation[] = [];
    for (let i = 0; i < args.operations.length; i++) {
        const op = args.operations[i];
        if (!op || typeof op !== 'object' || !op.action || !op.data) {
            const err = `operation ${i}: must be an object with "action" and "data"`;
            logAudit('preview', null, { status: 'validation_failed', error: err, attempted: args.operations });
            return errorResponse(err);
        }
        let validationError: string | null;
        switch (op.action) {
            case 'create':
                validationError = await validateCreateData(op.data);
                break;
            case 'update':
                validationError = await validateUpdateData(op.data);
                break;
            case 'manage':
                validationError = validateManageData(op.data);
                break;
            case 'split':
                validationError = validateSplitData(op.data);
                break;
            default:
                validationError = `unknown action "${op.action}" (must be create, update, manage, or split)`;
        }
        if (validationError) {
            const err = `operation ${i} (${op.action}): ${validationError}`;
            logAudit('preview', null, {
                status: 'validation_failed',
                error: err,
                attempted: args.operations,
            });
            return errorResponse(err);
        }
        normalized.push({ action: op.action, data: op.data });
    }

    const { token, expiresAt } = createBatch(normalized);
    const expiresIso = new Date(expiresAt).toISOString();

    logAudit('preview', token, { operations: normalized, expires_at: expiresIso });

    return textResponse({
        confirmation_token: token,
        expires_at: expiresIso,
        summary: summarize(normalized),
        operations: normalized,
    });
}

export async function handleEntryBatchCommit(args: any) {
    logger.debug('Handling entry_batch_commit tool', { args });

    const token = args?.confirmation_token;
    if (!token || typeof token !== 'string') {
        logAudit('commit', null, { status: 'missing_token', attempted: args });
        return errorResponse('Missing required parameter: confirmation_token');
    }

    const claimed = claimBatch(token);
    if (claimed.status !== 'ok') {
        logAudit('commit', token, { status: claimed.status });
        const msg =
            claimed.status === 'missing'
                ? 'Confirmation token not found. Call entry_batch_preview first.'
                : claimed.status === 'expired'
                  ? 'Confirmation token expired (tokens are valid for 5 minutes). Call entry_batch_preview again.'
                  : 'Confirmation token already used. Call entry_batch_preview again.';
        return errorResponse(msg);
    }

    // Atomic semantics: run ops sequentially, STOP on first failure. No
    // auto-rollback of already-committed ops — they stay applied. The result
    // reports which ops committed, which one failed, and which never ran so
    // the caller can reverse manually if needed.
    type CommittedResult = { index: number; action: string; status: 'committed'; result: any };
    type FailedResult = { index: number; action: string; status: 'failed'; error: string };
    type SkippedResult = { index: number; action: string; status: 'skipped'; reason: string };
    type OpResult = CommittedResult | FailedResult | SkippedResult;

    const results: OpResult[] = [];
    let aborted = false;
    let failedIndex: number | null = null;

    for (let i = 0; i < claimed.operations.length; i++) {
        const op = claimed.operations[i];

        if (aborted) {
            results.push({
                index: i,
                action: op.action,
                status: 'skipped',
                reason: `not run: operation ${failedIndex} failed`,
            });
            continue;
        }

        let outcome: OpOutcome;
        switch (op.action) {
            case 'create':
                outcome = await execCreate(op.data);
                break;
            case 'update':
                outcome = await execUpdate(op.data);
                break;
            case 'manage':
                outcome = await execManage(op.data);
                break;
            case 'split':
                outcome = await execSplit(op.data, token);
                break;
            default:
                outcome = { success: false, error: `unknown action: ${(op as any).action}` };
        }

        if (outcome.success) {
            results.push({ index: i, action: op.action, status: 'committed', result: outcome.result });
        } else {
            results.push({ index: i, action: op.action, status: 'failed', error: outcome.error });
            aborted = true;
            failedIndex = i;
        }
    }

    const committed = results.filter((r) => r.status === 'committed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    logAudit('commit', token, {
        total: results.length,
        committed,
        aborted,
        failed_index: failedIndex,
        skipped,
        results,
    });

    return textResponse({
        total: results.length,
        committed,
        aborted,
        failed_index: failedIndex,
        skipped,
        results,
    });
}

/* ------------------------------------------------------------------------- */
/* Delete / convert — gated by TOSHL_ALLOW_DELETE                            */
/* ------------------------------------------------------------------------- */

export async function handleEntryDeleteTool(args: any) {
    logger.debug('Handling entry_delete tool', { args });

    if (!isDeleteAllowed()) {
        logAudit('delete_blocked', null, { attempted: args });
        return errorResponse(
            'Entry deletion is disabled. Set TOSHL_ALLOW_DELETE=true to enable.',
        );
    }

    if (!args?.id) return errorResponse('Missing required parameter: id');

    try {
        const entriesClient = await createEntriesClient();
        await entriesClient.deleteEntry(args.id, args.deleteMode);
        return {
            content: [{ type: 'text', text: `Entry ${args.id} deleted successfully` }],
        };
    } catch (error) {
        logger.error('Error handling entry_delete tool', { args, error });
        return errorResponse(`Error deleting entry: ${(error as Error).message}`);
    }
}

export async function handleEntryConvertToTransferTool(args: {
    id: string;
    destination_account: string;
    description?: string;
}) {
    logger.debug('Handling entry_convert_to_transfer tool', { args });

    if (!isDeleteAllowed()) {
        logAudit('convert_blocked', null, { attempted: args });
        return errorResponse(
            'entry_convert_to_transfer requires deletion of the original entry, which is disabled. ' +
                'Set TOSHL_ALLOW_DELETE=true to enable.',
        );
    }

    if (!args?.id || !args?.destination_account) {
        return errorResponse(
            'Missing required parameters: id and destination_account are required',
        );
    }

    let transferCategoryId: string | null;
    try {
        transferCategoryId = await getTransferCategoryId();
    } catch (e) {
        logger.error('Failed to look up transfer category', { error: e });
        return errorResponse(
            `Failed to look up transfer category: ${(e as Error).message}`,
        );
    }
    if (!transferCategoryId) {
        return errorResponse(
            'No Transfer category resolved. Toshl categories have type expense|income|system; ' +
                'the source-side Transfer category typically has type=expense and name="Transfer". ' +
                'Use category_list to find your Transfer (expense) category, then set ' +
                'TOSHL_TRANSFER_CATEGORY_ID=<that id> and restart the MCP server.',
        );
    }

    try {
        const entriesClient = await createEntriesClient();
        const originalEntry = await entriesClient.getEntry(args.id);

        // Tags from the original are intentionally dropped — user tags are
        // scoped to user (expense/income) categories and Toshl rejects them
        // with 400 when attached to a transfer (system Transfer category).
        const transferEntry = {
            amount: originalEntry.amount,
            currency: originalEntry.currency,
            date: originalEntry.date,
            desc: args.description || `Transfer to ${args.destination_account}`,
            account: originalEntry.account,
            category: transferCategoryId,
            transaction: {
                account: args.destination_account,
                currency: originalEntry.currency,
            } as any,
        };

        const newEntry = await entriesClient.createEntry(transferEntry);
        await entriesClient.deleteEntry(args.id);

        return textResponse(newEntry);
    } catch (error) {
        logger.error('Error handling entry_convert_to_transfer tool', { args, error });
        return errorResponse(
            `Error converting entry to transfer: ${(error as Error).message}`,
        );
    }
}

/* ------------------------------------------------------------------------- */
/* Dispatcher                                                                */
/* ------------------------------------------------------------------------- */

export async function handleEntryTool(toolName: string, args: any) {
    switch (toolName) {
        case 'entry_list':
            return handleEntryListTool(args);
        case 'entry_get':
            return handleEntryGetTool(args as { id: string });
        case 'entry_sums':
            return handleEntrySumsTool(args);
        case 'entry_timeline':
            return handleEntryTimelineTool(args);
        case 'entry_batch_preview':
            return handleEntryBatchPreview(args);
        case 'entry_batch_commit':
            return handleEntryBatchCommit(args);
        case 'entry_delete':
            // Handler is kept for the case where the flag is off but a caller
            // still attempts the unlisted tool — we log and refuse.
            return handleEntryDeleteTool(args);
        case 'entry_convert_to_transfer':
            return handleEntryConvertToTransferTool(
                args as { id: string; destination_account: string; description?: string },
            );
        default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${toolName}`);
    }
}
