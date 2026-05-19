const mysql = require('mysql2');
const { performance } = require('perf_hooks');
const Sentry = require('@sentry/node');

if (
  !process.env.DB_HOST ||
  !process.env.DB_USER ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_NAME
) {
  console.error('FATAL: Missing required database environment variables.');
  process.exit(1);
}

// Create connection pool with high-scale production settings
const rawPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,  
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  
  // Connection Pool Optimizations for production scale
  waitForConnections: true,
  connectionLimit: 10,          // Scale down from 15 to 10 for Railway low-RAM/CPU optimization
  queueLimit: 0,                // Allow infinite queueing under high bursts
  timezone: '+05:30',
  
  // Timeouts & Keep-Alives to prevent Railway 502/restarts and cold delays
  connectTimeout: 10000,        // 10 seconds to connect
  enableKeepAlive: true,        // Prevent connection drop-offs by active TCP ping
  keepAliveInitialDelay: 30000  // Ping every 30 seconds (reduces idle Railway CPU wakeups)
});

const promisePool = rawPool.promise();

/**
 * Automatically retry DB operations on temporary/retryable failure states
 */
async function executeWithRetry(operation, maxRetries = 3, baseDelayMs = 200) {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err) {
      attempt++;
      
      const isRetryable = [
        'PROTOCOL_CONNECTION_LOST',
        'ECONNREFUSED',
        'ER_SERVER_SHUTDOWN',
        'ETIMEDOUT',
        'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
        'POOL_CLOSED'
      ].includes(err.code) || 
      err.message.includes('Pool was closed') || 
      err.message.includes('connection') ||
      err.message.includes('lost');

      if (attempt >= maxRetries || !isRetryable) {
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[DB RETRY] Transient error detected (${err.code || err.message}). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Log queries exceeding 300ms threshold for performance monitoring
 */
function logQueryTime(sql, duration, isSlow) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (isSlow) {
    console.warn(`\x1b[33m[SLOW QUERY ALERT] (${duration.toFixed(1)}ms) - ${cleanSql}...\x1b[0m`);
    if (process.env.SENTRY_DSN) {
      Sentry.addBreadcrumb({
        category: 'database',
        message: `Slow Query ALERT: ${duration.toFixed(1)}ms - ${cleanSql}`,
        level: 'warning'
      });
    }
  }
}

/**
 * Wrapped DB Connection class to intercept connection-scoped queries
 */
class WrappedConnection {
  constructor(conn) {
    this.conn = conn;
  }

  async query(sql, values) {
    const start = performance.now();
    try {
      const result = await executeWithRetry(() => this.conn.query(sql, values));
      const duration = performance.now() - start;
      if (duration > 300) logQueryTime(sql, duration, true);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      console.error(`\x1b[31m[DB EXCEPTION] (${duration.toFixed(1)}ms) - Query failed: ${err.message}\nSQL: ${sql}\x1b[0m`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { sql, values, durationMs: duration } });
      }
      throw err;
    }
  }

  async execute(sql, values) {
    const start = performance.now();
    try {
      const result = await executeWithRetry(() => this.conn.execute(sql, values));
      const duration = performance.now() - start;
      if (duration > 300) logQueryTime(sql, duration, true);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      console.error(`\x1b[31m[DB EXCEPTION] (${duration.toFixed(1)}ms) - Execute failed: ${err.message}\nSQL: ${sql}\x1b[0m`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { sql, values, durationMs: duration } });
      }
      throw err;
    }
  }

  async beginTransaction() {
    return this.conn.beginTransaction();
  }

  async commit() {
    return this.conn.commit();
  }

  async rollback() {
    return this.conn.rollback();
  }

  release() {
    this.conn.release();
  }
}

/**
 * Transparent Wrapper around standard mysql2 PromisePool
 */
const dbWrapper = {
  async query(sql, values) {
    const start = performance.now();
    try {
      const result = await executeWithRetry(() => promisePool.query(sql, values));
      const duration = performance.now() - start;
      if (duration > 300) logQueryTime(sql, duration, true);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      console.error(`\x1b[31m[DB EXCEPTION] (${duration.toFixed(1)}ms) - Pool query failed: ${err.message}\nSQL: ${sql}\x1b[0m`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { sql, values, durationMs: duration } });
      }
      throw err;
    }
  },

  async execute(sql, values) {
    const start = performance.now();
    try {
      const result = await executeWithRetry(() => promisePool.execute(sql, values));
      const duration = performance.now() - start;
      if (duration > 300) logQueryTime(sql, duration, true);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      console.error(`\x1b[31m[DB EXCEPTION] (${duration.toFixed(1)}ms) - Pool execute failed: ${err.message}\nSQL: ${sql}\x1b[0m`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { sql, values, durationMs: duration } });
      }
      throw err;
    }
  },

  async getConnection() {
    const start = performance.now();
    try {
      const conn = await executeWithRetry(() => promisePool.getConnection());
      return new WrappedConnection(conn);
    } catch (err) {
      const duration = performance.now() - start;
      console.error(`\x1b[31m[DB POOL FATAL] Failed to acquire connection in ${duration.toFixed(1)}ms: ${err.message}\x1b[0m`);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { durationMs: duration } });
      }
      throw err;
    }
  },

  // Event handlers and utility methods delegation
  on(event, listener) {
    return promisePool.on(event, listener);
  },

  end() {
    return promisePool.end();
  }
};

module.exports = dbWrapper;