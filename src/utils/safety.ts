/**
 * Safety-flag helpers.
 *
 * TOSHL_ALLOW_DELETE gates any operation that deletes a Toshl entry. The flag
 * is treated as false unless the env var is exactly the string "true".
 */
export function isDeleteAllowed(): boolean {
    return process.env.TOSHL_ALLOW_DELETE === 'true';
}
