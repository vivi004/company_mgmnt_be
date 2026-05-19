const { performance } = require('perf_hooks');
const Sentry = require('@sentry/node');

/**
 * Structured request logging and performance tracking middleware.
 * Logs response times, URLs, status codes, and issues real-time warnings for slow requests (>300ms).
 */
module.exports = (req, res, next) => {
    const start = performance.now();

    res.on('finish', () => {
        const duration = performance.now() - start;
        const statusCode = res.statusCode;
        const method = req.method;
        const url = req.originalUrl || req.url;

        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${method} ${url} - Status: ${statusCode} - Time: ${duration.toFixed(1)}ms`;

        // Slow query / request threshold alert (300ms)
        if (duration > 300) {
            console.warn(`\x1b[33m[SLOW REQUEST WARNING] ${logLine}\x1b[0m`);
            
            if (process.env.SENTRY_DSN) {
                Sentry.addBreadcrumb({
                    category: 'performance',
                    message: `Slow Request Warning: ${method} ${url} took ${duration.toFixed(1)}ms`,
                    level: 'warning'
                });
            }
        } else {
            console.log(`\x1b[32m[REQUEST] ${logLine}\x1b[0m`);
        }

        // Attach safe User Context to Sentry error scopes if authenticated
        if (req.user && process.env.SENTRY_DSN) {
            Sentry.setUser({
                id: req.user.id,
                role: req.user.role || 'staff'
            });
        }
    });

    next();
};
