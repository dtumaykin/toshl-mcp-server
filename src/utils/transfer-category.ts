import logger from './logger.js';

let cachedId: string | null | undefined = undefined;
let inflight: Promise<string | null> | null = null;

/**
 * Resolves the Toshl "Transfer" category ID for the SOURCE side of a transfer
 * entry, caching the result for the lifetime of the process. Returns null if
 * no matching category can be found. Throws on transient fetch errors.
 *
 * Toshl categories have `type: 'expense' | 'income' | 'system'` — there is no
 * `'transfer'` type. The system Transfer category is created in two forms:
 *
 *   - one with `type: 'expense'` (source side — money leaves the account)
 *   - one with `type: 'income'`  (destination side — money arrives)
 *
 * When we create a transfer entry attached to the user's source account, we
 * need the EXPENSE-side Transfer category. We resolve it in this order:
 *
 *   1. TOSHL_TRANSFER_CATEGORY_ID env var — escape hatch for non-English
 *      accounts or any case where auto-detection fails.
 *   2. categories where `type === 'expense'` and `name` matches /^transfer$/i.
 *   3. categories where `type === 'system'` and `name` matches /transfer/i —
 *      defensive fallback in case Toshl returns the Transfer category as
 *      type 'system' on some accounts.
 */
export async function getTransferCategoryId(): Promise<string | null> {
    if (cachedId !== undefined) return cachedId;
    if (inflight) return inflight;

    inflight = (async () => {
        // 1. Env-var override.
        const override = process.env.TOSHL_TRANSFER_CATEGORY_ID;
        if (override && override.trim().length > 0) {
            cachedId = override.trim();
            logger.info('Transfer category set from TOSHL_TRANSFER_CATEGORY_ID', { id: cachedId });
            return cachedId;
        }

        // 2 + 3. Look up the system Transfer category from the API.
        const { createCategoriesClient } = await import('../api/endpoints/categories.js');
        const client = await createCategoriesClient();
        const categories = await client.listCategories();

        const byNameAndExpense = categories.filter(
            (c: any) => c.type === 'expense' && typeof c.name === 'string' && /^transfer$/i.test(c.name),
        );
        const bySystem = categories.filter(
            (c: any) => c.type === 'system' && typeof c.name === 'string' && /transfer/i.test(c.name),
        );

        const matches = byNameAndExpense.length > 0 ? byNameAndExpense : bySystem;

        if (matches.length === 0) {
            logger.warn(
                'No Transfer category found in Toshl account. ' +
                    'Set TOSHL_TRANSFER_CATEGORY_ID to the source-side (type=expense) "Transfer" category ID, ' +
                    'or call category_list to inspect available categories.',
            );
            cachedId = null;
            return null;
        }
        if (matches.length > 1) {
            logger.warn('Multiple Transfer categories matched; using the first', {
                count: matches.length,
                chosen: matches[0].id,
                ids: matches.map((c: any) => c.id),
            });
        }
        cachedId = matches[0].id;
        logger.info('Transfer category resolved', { id: cachedId, name: matches[0].name, type: matches[0].type });
        return cachedId;
    })().catch((err) => {
        inflight = null;
        throw err;
    });

    return inflight;
}
