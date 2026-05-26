import logger from './logger.js';

let cachedId: string | null | undefined = undefined;
let inflight: Promise<string | null> | null = null;

/**
 * Resolves the Toshl "transfer"-type category ID, caching the result for the
 * lifetime of the process. Returns null if no transfer category exists on the
 * account. Throws on transient fetch errors so callers can retry.
 */
export async function getTransferCategoryId(): Promise<string | null> {
    if (cachedId !== undefined) return cachedId;
    if (inflight) return inflight;

    inflight = (async () => {
        const { createCategoriesClient } = await import('../api/endpoints/categories.js');
        const client = await createCategoriesClient();
        const categories = await client.listCategories();
        const transfers = categories.filter((c: any) => c.type === 'transfer');
        if (transfers.length === 0) {
            logger.warn('No transfer-type category found in Toshl account');
            cachedId = null;
            return null;
        }
        if (transfers.length > 1) {
            logger.warn('Multiple transfer-type categories found; using the first', {
                count: transfers.length,
                chosen: transfers[0].id,
            });
        }
        cachedId = transfers[0].id;
        logger.info('Transfer category resolved', { id: cachedId });
        return cachedId;
    })().catch((err) => {
        inflight = null;
        throw err;
    });

    return inflight;
}
