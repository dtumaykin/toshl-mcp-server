import logger from './logger.js';

let cachedId: string | null | undefined = undefined;
let inflight: Promise<string | null> | null = null;

/**
 * Resolves the Toshl system "Reconciliation" category ID for the process
 * lifetime. Used to reject writes that try to attach this category to a
 * user-created entry — Toshl only allows the reconciliation category on
 * entries it generates itself in response to a balance-adjustment on
 * /accounts/{id} (creates 400/403 on entry create/update otherwise).
 *
 * Resolution order:
 *   1. TOSHL_RECONCILIATION_CATEGORY_ID env override.
 *   2. categories where `type === 'system'` and `name` matches /^reconc/i.
 *
 * Returns null if not resolved. Callers should treat null as "unknown" and
 * skip the check rather than blocking legitimate writes.
 */
export async function getReconciliationCategoryId(): Promise<string | null> {
    if (cachedId !== undefined) return cachedId;
    if (inflight) return inflight;

    inflight = (async () => {
        const override = process.env.TOSHL_RECONCILIATION_CATEGORY_ID;
        if (override && override.trim().length > 0) {
            cachedId = override.trim();
            logger.info('Reconciliation category set from TOSHL_RECONCILIATION_CATEGORY_ID', { id: cachedId });
            return cachedId;
        }

        const { createCategoriesClient } = await import('../api/endpoints/categories.js');
        const client = await createCategoriesClient();
        const categories = await client.listCategories();

        const matches = categories.filter(
            (c: any) => c.type === 'system' && typeof c.name === 'string' && /^reconc/i.test(c.name),
        );

        if (matches.length === 0) {
            logger.debug(
                'No Reconciliation category detected. Preview-time reject on this ID will be skipped; ' +
                    'commit-time attempt to write it would still fail with 400/403 from Toshl. ' +
                    'Set TOSHL_RECONCILIATION_CATEGORY_ID to enable preview-time rejection.',
            );
            cachedId = null;
            return null;
        }
        if (matches.length > 1) {
            logger.warn('Multiple Reconciliation categories matched; using the first', {
                count: matches.length,
                chosen: matches[0].id,
                ids: matches.map((c: any) => c.id),
            });
        }
        cachedId = matches[0].id;
        logger.info('Reconciliation category resolved', { id: cachedId, name: matches[0].name });
        return cachedId;
    })().catch((err) => {
        inflight = null;
        throw err;
    });

    return inflight;
}
