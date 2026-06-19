import { ToshlApiClient } from '../toshl-client.js';
import { ToshlAccount } from '../../utils/types.js';
import logger from '../../utils/logger.js';

/**
 * Client for the Toshl Accounts API
 */
export class AccountsClient {
    private client: ToshlApiClient;

    /**
     * Creates a new accounts client
     * @param client The Toshl API client
     */
    constructor(client: ToshlApiClient) {
        this.client = client;
        logger.debug('Accounts client initialized');
    }

    /**
     * Gets a list of all accounts
     * @returns List of accounts
     */
    async listAccounts(): Promise<ToshlAccount[]> {
        logger.debug('Fetching accounts list');
        return this.client.getAll<ToshlAccount>('/accounts');
    }

    /**
     * Gets a specific account by ID
     * @param id Account ID
     * @returns Account details
     */
    async getAccount(id: string): Promise<ToshlAccount> {
        logger.debug('Fetching account details', { id });

        const response = await this.client.get<ToshlAccount>(`/accounts/${id}`);
        return response.data;
    }
}

/**
 * Creates an accounts client using the default Toshl API client
 * @param client Optional custom Toshl API client
 * @returns Accounts client
 */
export async function createAccountsClient(client?: ToshlApiClient): Promise<AccountsClient> {
    // If no client is provided, import the default one
    if (!client) {
        // Using dynamic import to avoid circular dependency
        const { default: defaultClient } = await import('../toshl-client.js');
        return new AccountsClient(defaultClient);
    }

    return new AccountsClient(client);
}
