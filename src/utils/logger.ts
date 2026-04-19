import winston from 'winston';

/**
 * Sets up the logger for the application.
 * IMPORTANT: MCP stdio servers use stdout for JSON-RPC protocol messages.
 * All logs MUST go to stderr, or the client will fail to parse them as protocol.
 */
export function setupLogger() {
    const logLevel = process.env.LOG_LEVEL || 'info';

    const logger = winston.createLogger({
        level: logLevel,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        defaultMeta: { service: 'toshl-mcp-server' },
        transports: [
            new winston.transports.Console({
                stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
                format: winston.format.combine(
                    winston.format.simple()
                )
            })
        ]
    });

    return logger;
}

const logger = setupLogger();
export default logger;