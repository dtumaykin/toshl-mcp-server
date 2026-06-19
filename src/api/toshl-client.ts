import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { AuthProvider, createAuthProvider } from './auth.js';
import { ApiClientConfig, ApiResponse } from '../utils/types.js';
import { handleApiError } from '../utils/error-handler.js';
import cache from '../utils/cache.js';
import logger from '../utils/logger.js';

/**
 * Base client for Toshl API
 */
export class ToshlApiClient {
    private client: AxiosInstance;
    private authProvider: AuthProvider;
    private baseUrl: string;

    /**
     * Creates a new Toshl API client
     * @param config Client configuration
     * @param authProvider Authentication provider
     */
    constructor(config: ApiClientConfig, authProvider: AuthProvider) {
        this.baseUrl = config.baseUrl;
        this.authProvider = authProvider;

        this.client = axios.create({
            baseURL: config.baseUrl,
            timeout: config.timeout || 10000,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        // Add request interceptor for authentication
        this.client.interceptors.request.use(
            (config) => {
                // Add authentication headers
                const authHeaders = this.authProvider.getAuthHeaders();
                // @ts-ignore TODO: check this
                config.headers = { ...config.headers, ...authHeaders };

                // Add If-None-Match header if we have a cached ETag
                const cacheKey = `etag:${config.method}:${config.url}`;
                const etag = cache.get<string>(cacheKey);
                if (etag) {
                    config.headers['If-None-Match'] = etag;
                }

                return config;
            },
            (error) => {
                return Promise.reject(error);
            }
        );

        // Add response interceptor for caching
        this.client.interceptors.response.use(
            (response) => {
                // Cache ETag if present
                const etag = response.headers['etag'];
                if (etag) {
                    const cacheKey = `etag:${response.config.method}:${response.config.url}`;
                    cache.set(cacheKey, etag);

                    // Cache response data
                    const dataKey = `data:${response.config.method}:${response.config.url}`;
                    cache.set(dataKey, response.data);
                }

                return response;
            },
            (error) => {
                // If 304 Not Modified, return cached data
                if (error.response && error.response.status === 304) {
                    const dataKey = `data:${error.config.method}:${error.config.url}`;
                    const cachedData = cache.get(dataKey);

                    if (cachedData) {
                        logger.debug('Using cached data (304 Not Modified)', { url: error.config.url });

                        // Create a successful response with cached data
                        return {
                            ...error.response,
                            status: 200,
                            data: cachedData,
                            fromCache: true
                        };
                    }
                }

                return Promise.reject(error);
            }
        );

        logger.debug('Toshl API client initialized', { baseUrl: config.baseUrl });
    }

    /**
     * Makes a GET request to the Toshl API
     * @param path API path
     * @param params Query parameters
     * @param config Additional Axios config
     * @returns API response
     */
    async get<T>(path: string, params?: Record<string, any>, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse = await this.client.get(path, {
                ...config,
                params
            });

            return {
                data: response.data,
                status: response.status,
                headers: response.headers as Record<string, string>
            };
        } catch (error) {
            handleApiError(error);
            // This line will never be reached due to handleApiError throwing an error
            throw error;
        }
    }

    /**
     * Makes a POST request to the Toshl API
     * @param path API path
     * @param data Request body
     * @param params Query parameters
     * @param config Additional Axios config
     * @returns API response
     */
    async post<T>(path: string, data: any, params?: Record<string, any>, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse = await this.client.post(path, data, {
                ...config,
                params
            });

            return {
                data: response.data,
                status: response.status,
                headers: response.headers as Record<string, string>
            };
        } catch (error) {
            handleApiError(error);
            // This line will never be reached due to handleApiError throwing an error
            throw error;
        }
    }

    /**
     * Makes a PUT request to the Toshl API
     * @param path API path
     * @param data Request body
     * @param params Query parameters
     * @param config Additional Axios config
     * @returns API response
     */
    async put<T>(path: string, data: any, params?: Record<string, any>, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse = await this.client.put(path, data, {
                ...config,
                params
            });

            return {
                data: response.data,
                status: response.status,
                headers: response.headers as Record<string, string>
            };
        } catch (error) {
            handleApiError(error);
            // This line will never be reached due to handleApiError throwing an error
            throw error;
        }
    }

    /**
     * Makes a DELETE request to the Toshl API
     * @param path API path
     * @param params Query parameters
     * @param config Additional Axios config
     * @returns API response
     */
    async delete<T>(path: string, params?: Record<string, any>, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse = await this.client.delete(path, {
                ...config,
                params
            });

            return {
                data: response.data,
                status: response.status,
                headers: response.headers as Record<string, string>
            };
        } catch (error) {
            handleApiError(error);
            // This line will never be reached due to handleApiError throwing an error
            throw error;
        }
    }

    /**
     * GETs every page of a list endpoint, following Link: rel="next" headers,
     * and returns the concatenated items. Use for endpoints whose response is
     * a JSON array that may exceed Toshl's per-page cap (200 by default).
     *
     * The first page is fetched via the standard `get()` (cache + error handling
     * applies). Subsequent pages use the absolute URL from the next-link header
     * and call axios directly — axios ignores `baseURL` for absolute URLs.
     *
     * Capped at MAX_PAGES as a runaway-loop safety net; logs a warning if hit.
     */
    async getAll<T>(path: string, params?: Record<string, any>): Promise<T[]> {
        const MAX_PAGES = 200;
        const all: T[] = [];

        const first = await this.get<T[]>(path, params);
        all.push(...first.data);
        let nextUrl = this.parseNextLink(first.headers['link']);

        let page = 1;
        while (nextUrl && page < MAX_PAGES) {
            try {
                const resp: AxiosResponse = await this.client.get(nextUrl);
                all.push(...(resp.data as T[]));
                nextUrl = this.parseNextLink(resp.headers['link']);
            } catch (error) {
                handleApiError(error);
                throw error;
            }
            page++;
        }

        if (page >= MAX_PAGES && nextUrl) {
            logger.warn('getAll reached safety cap; results may be incomplete', {
                path,
                pages: MAX_PAGES,
                total: all.length,
            });
        }
        if (page > 1) {
            logger.debug('getAll paginated', { path, pages: page, total: all.length });
        }

        return all;
    }

    private parseNextLink(linkHeader: string | undefined): string | null {
        if (!linkHeader) return null;
        const m = String(linkHeader).match(/<([^>]+)>\s*;\s*rel="next"/);
        return m ? m[1] : null;
    }

    /**
     * Checks if the client is properly authenticated
     * @returns true if authenticated
     */
    isAuthenticated(): boolean {
        return this.authProvider.isConfigured();
    }

    /**
     * Gets the base URL of the API
     * @returns Base URL
     */
    getBaseUrl(): string {
        return this.baseUrl;
    }
}

/**
 * Creates a Toshl API client from environment variables
 * @returns Configured Toshl API client
 */
export function createToshlApiClient(): ToshlApiClient {
    const baseUrl = process.env.TOSHL_API_BASE_URL || 'https://api.toshl.com';

    const config: ApiClientConfig = {
        baseUrl,
        token: process.env.TOSHL_API_TOKEN || '',
        timeout: parseInt(process.env.API_TIMEOUT || '10000', 10)
    };

    const authProvider = createAuthProvider();

    return new ToshlApiClient(config, authProvider);
}

// Create a default client instance
const toshlApiClient = createToshlApiClient();

export default toshlApiClient;
