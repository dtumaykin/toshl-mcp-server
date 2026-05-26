#!/usr/bin/env node
import dotenv from 'dotenv';
import { ToshlMcpServer } from './server/server.js';
import { setupLogger } from './utils/logger.js';
import { initAuditLog } from './utils/audit-log.js';

// Load environment variables
dotenv.config();

// Setup logger
const logger = setupLogger();

// Start the server
async function main() {
    try {
        logger.info('Starting Toshl MCP Server...');

        // Ensure the audit-log directory exists before any tool can fire.
        initAuditLog();

        const server = new ToshlMcpServer();
        await server.start();

        logger.info('Toshl MCP Server started successfully');

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('Shutting down Toshl MCP Server...');
            await server.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Shutting down Toshl MCP Server...');
            await server.stop();
            process.exit(0);
        });
    } catch (error) {
        logger.error('Failed to start Toshl MCP Server', { error });
        process.exit(1);
    }
}

main();
