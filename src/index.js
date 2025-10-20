import './styles.css';
import { BuildingRadar } from './core/BuildingRadar.js';
import { DataLoader } from './core/DataLoader.js';

/**
 * Crash Detection & Logging System
 * Logs errors to localStorage to survive page reloads
 */
class CrashLogger {
    constructor() {
        this.logKey = 'buildingRadar_crashLog';
        this.setupGlobalHandlers();
        this.checkPreviousCrash();
    }

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

        console.error(' CRASH DETECTED:', crash);

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

    getLogs() {
        try {
            const logs = localStorage.getItem(this.logKey);
            return logs ? JSON.parse(logs) : [];
        } catch (e) {
            return [];
        }
    }

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

    checkPreviousCrash() {
        const logs = this.getLogs();
        if (logs.length > 0) {
            console.warn(' Previous crash/event logs found:', logs);
            console.warn('Run crashLogger.clearLogs() to clear or crashLogger.getLogs() to view');
        }
    }

    clearLogs() {
        localStorage.removeItem(this.logKey);
        console.log('Crash logs cleared');
    }
}

// Initialize crash logger immediately
const crashLogger = new CrashLogger();
window.crashLogger = crashLogger; // Make available in console

/**
 * Register service worker for offline support
 */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/BuildingRadar/sw.js')
            .then(registration => {
                console.log('Service Worker registered:', registration.scope);

                // Check for updates periodically
                setInterval(() => {
                    registration.update();
                }, 60000); // Check every minute
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });

        // Listen for service worker updates
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
                console.log('Update available:', event.data.message);
                // Could show a notification to the user here
            }
        });

        // Handle online/offline events
        window.addEventListener('online', () => {
            console.log('App is online');
            // Notify service worker to check for updates
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'CHECK_UPDATE'
                });
            }
        });

        window.addEventListener('offline', () => {
            console.log('App is offline');
        });
    });
}

/**
 * Initialize the application
 */
let app = null;
let dataLoader = null;
let buildingsLoadedHandled = false;

function initApp() {
    try {
        crashLogger.logEvent('APP_INIT_START');
        console.log('Initializing BuildingRadar application...');

        // Log memory info
        const memInfo = crashLogger.getMemoryInfo();
        if (memInfo) {
            console.log('Memory available:', memInfo);
        }

        // Initialize data loader (will auto-restore if data exists)
        dataLoader = new DataLoader();

        // Wait for buildings data to be loaded (either from file or restored from storage)
        window.addEventListener('buildingsLoaded', (event) => {
            // Prevent handling the event multiple times
            if (buildingsLoadedHandled) {
                console.log('Buildings data already loaded, ignoring duplicate event');
                return;
            }
            buildingsLoadedHandled = true;

            const spatialIndex = event.detail;
            if (!spatialIndex || typeof spatialIndex.queryRadius !== 'function') {
                console.error('Invalid spatial index received');
                return;
            }

            console.log(`Spatial index loaded: ${spatialIndex.getFeatureCount()} features`);

            // Create and start the application with spatial index
            app = new BuildingRadar(spatialIndex);

            // Handle page visibility changes to manage resources
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    console.log('Page hidden - pausing updates');
                    // App continues running but could be optimized
                } else {
                    console.log('Page visible - resuming');
                    // Could restart GPS if it stopped
                }
            });

            // Handle page unload
            window.addEventListener('beforeunload', () => {
                if (app) {
                    app.destroy();
                }
            });

            console.log('BuildingRadar application started successfully');
        });

        // Check if data was restored
        const hasStoredData = dataLoader.getSpatialIndex() !== null;
        if (hasStoredData) {
            console.log('Spatial index restored from previous session');
        } else {
            console.log('Waiting for shapefile to be loaded...');
        }
    } catch (error) {
        console.error('Failed to initialize application:', error);
    }
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}