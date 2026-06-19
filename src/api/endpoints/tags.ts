import { ToshlApiClient } from '../toshl-client.js';
import { ToshlTag } from '../../utils/types.js';
import logger from '../../utils/logger.js';

/**
 * Client for the Toshl Tags API
 */
export class TagsClient {
    private client: ToshlApiClient;

    /**
     * Creates a new tags client
     * @param client The Toshl API client
     */
    constructor(client: ToshlApiClient) {
        this.client = client;
        logger.debug('Tags client initialized');
    }

    /**
     * Gets a list of all tags
     * @returns List of tags
     */
    async listTags(): Promise<ToshlTag[]> {
        logger.debug('Fetching tags list');
        return this.client.getAll<ToshlTag>('/tags');
    }

    /**
     * Gets a specific tag by ID
     * @param id Tag ID
     * @returns Tag details
     */
    async getTag(id: string): Promise<ToshlTag> {
        logger.debug('Fetching tag details', { id });

        const response = await this.client.get<ToshlTag>(`/tags/${id}`);
        return response.data;
    }
}

/**
 * Creates a tags client using the default Toshl API client
 * @param client Optional custom Toshl API client
 * @returns Tags client
 */
export async function createTagsClient(client?: ToshlApiClient): Promise<TagsClient> {
    // If no client is provided, import the default one
    if (!client) {
        // Using dynamic import to avoid circular dependency
        const { default: defaultClient } = await import('../toshl-client.js');
        return new TagsClient(defaultClient);
    }

    return new TagsClient(client);
}
