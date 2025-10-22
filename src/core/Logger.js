/**
 * Logger - Crash Detection & Logging System
 * Intercepts console messages and logs errors to localStorage to survive page reloads
 * Optimized for debugging crashes on mobile devices
 */
export class CrashLogger {
    constructor() {
        this.logKey = 'buildingRadar_crashLog';
        this.consoleLogKey = 'buildingRadar_consoleLogs';
        this.maxConsoleLogs = 500; // Keep last 500 console messages
        this.setupConsoleInterceptor();
        this.setupGlobalHandlers();
        this.checkPreviousCrash();
    }

    /**
     * Intercept all console methods to persist logs to localStorage
     */
    setupConsoleInterceptor() {
        // Store original console methods
        const originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            info: console.info,
            debug: console.debug
        };

        // Intercept console methods
        ['log', 'warn', 'error', 'info', 'debug'].forEach(method => {
            console[method] = (...args) => {
                // Call original console method first
                originalConsole[method].apply(console, args);

                // Persist to localStorage
                try {
                    const logEntry = {
                        type: method.toUpperCase(),
                        message: args.map(arg => {
                            if (typeof arg === 'object') {
                                try {
                                    return JSON.stringify(arg);
                                } catch (e) {
                                    return String(arg);
                                }
                            }
                            return String(arg);
                        }).join(' '),
                        timestamp: new Date().toISOString(),
                        memory: this.getMemoryInfo()
                    };

                    const logs = this.getConsoleLogs();
                    logs.push(logEntry);

                    // Keep only last N logs (circular buffer)
                    if (logs.length > this.maxConsoleLogs) {
                        logs.splice(0, logs.length - this.maxConsoleLogs);
                    }

                    localStorage.setItem(this.consoleLogKey, JSON.stringify(logs));
                } catch (e) {
                    // If localStorage is full or error occurs, fail silently
                    // Use original console to avoid infinite loop
                    originalConsole.error('Failed to persist console log:', e);
                }
            };
        });

        console.log('📝 Console interceptor active - logs will persist across crashes');
    }

    /**
     * Setup global error handlers to catch unhandled errors and promise rejections
     */
    setupGlobalHandlers() {
        // Catch unhandled errors
        window.addEventListener('error', (event) => {
            this.logCrash('ERROR', event.message, event.filename, event.lineno, event.colno, event.error?.stack);
        });

        // Catch unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.logCrash('PROMISE_REJECTION', event.reason?.message || event.reason, null, null, null, event.reason?.stack);
        });

        // Log when page is about to unload (might be a crash)
        window.addEventListener('beforeunload', () => {
            this.logEvent('PAGE_UNLOAD');
        });
    }

    /**
     * Log a crash with full context
     */
    logCrash(type, message, filename, line, col, stack) {
        const crash = {
            type,
            message: String(message),
            filename,
            line,
            col,
            stack,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            memory: this.getMemoryInfo()
        };

        console.error('🔥 CRASH DETECTED:', crash);

        try {
            const logs = this.getLogs();
            logs.push(crash);
            // Keep only last 10 crashes
            if (logs.length > 10) logs.shift();
            localStorage.setItem(this.logKey, JSON.stringify(logs));
        } catch (e) {
            console.error('Failed to save crash log:', e);
        }
    }

    /**
     * Log an application event
     */
    logEvent(eventName, data = {}) {
        const event = {
            type: 'EVENT',
            event: eventName,
            data,
            timestamp: new Date().toISOString(),
            memory: this.getMemoryInfo()
        };

        try {
            const logs = this.getLogs();
            logs.push(event);
            if (logs.length > 10) logs.shift();
            localStorage.setItem(this.logKey, JSON.stringify(logs));
        } catch (e) {
            console.error('Failed to save event log:', e);
        }
    }

    /**
     * Get all crash/event logs
     */
    getLogs() {
        try {
            const logs = localStorage.getItem(this.logKey);
            return logs ? JSON.parse(logs) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Get all console logs
     */
    getConsoleLogs() {
        try {
            const logs = localStorage.getItem(this.consoleLogKey);
            return logs ? JSON.parse(logs) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Get current memory usage info
     */
    getMemoryInfo() {
        if (performance.memory) {
            return {
                usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + 'MB',
                totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024) + 'MB',
                jsHeapSizeLimit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024) + 'MB'
            };
        }
        return null;
    }

    /**
     * Check for previous crashes/logs on page load
     */
    checkPreviousCrash() {
        const logs = this.getLogs();
        const consoleLogs = this.getConsoleLogs();

        if (logs.length > 0) {
            console.warn('🔴 Previous crash/event logs found:', logs);
            console.warn('Run crashLogger.clearLogs() to clear or crashLogger.getLogs() to view');
        }

        if (consoleLogs.length > 0) {
            console.warn(`📝 ${consoleLogs.length} console logs persisted from previous session`);
            console.warn('Run crashLogger.getConsoleLogs() to view or crashLogger.clearConsoleLogs() to clear');
            console.warn('Or use crashLogger.exportLogs() to see everything');
        }
    }

    /**
     * Clear console logs
     */
    clearConsoleLogs() {
        localStorage.removeItem(this.consoleLogKey);
        console.log('Console logs cleared');
    }

    /**
     * Clear crash/event logs
     */
    clearLogs() {
        localStorage.removeItem(this.logKey);
        console.log('Crash logs cleared');
    }

    /**
     * Clear all logs (console + crash/event)
     */
    clearAllLogs() {
        this.clearLogs();
        this.clearConsoleLogs();
        console.log('All logs cleared');
    }

    /**
     * Export all logs as structured data
     */
    exportLogs() {
        const crashLogs = this.getLogs();
        const consoleLogs = this.getConsoleLogs();
        const data = {
            crashLogs,
            consoleLogs,
            exportedAt: new Date().toISOString()
        };
        console.log('📊 Exported logs:', data);
        return data;
    }
}

/**
 * Initialize crash logger and expose globally
 * @returns {CrashLogger} The initialized crash logger instance
 */
export function initializeCrashLogger() {
    const crashLogger = new CrashLogger();
    window.crashLogger = crashLogger; // Make available in console
    return crashLogger;
}