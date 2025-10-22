import './styles.css';
import { BuildingRadar } from './core/BuildingRadar.js';
import { DataLoader } from './core/DataLoader.js';
import { initializeCrashLogger, isDebugMode } from './core/Logger.js';

// Check if debug mode is enabled
const debugModeEnabled = isDebugMode();

// Conditionally load Eruda only in debug mode
if (debugModeEnabled && typeof window !== 'undefined') {
    import('eruda').then(eruda => {
        eruda.default.init();
        console.log(' Eruda devtools initialized');
    }).catch(err => {
        console.warn('Failed to load Eruda:', err);
    });
}

// Initialize crash logger with debug mode
const crashLogger = initializeCrashLogger({ debugMode: debugModeEnabled });

/**
 * Setup debug mode toggle in modal
 */
function setupDebugToggle() {
    const toggle = document.getElementById('debugModeToggle');
    if (!toggle) return;

    // Set initial state
    toggle.checked = debugModeEnabled;

    // Handle toggle change
    toggle.addEventListener('change', () => {
        const newMode = toggle.checked;
        crashLogger.setDebugMode(newMode);

        // Show notification
        const msg = newMode
            ? 'Debug mode enabled. Eruda will load on next page reload.'
            : 'Debug mode disabled. Changes will apply on next reload.';

        alert(msg);

        // Reload page to apply changes
        window.location.reload();
    });
}

// Setup toggle when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDebugToggle);
} else {
    setupDebugToggle();
}

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

            // Create the application with spatial index
            app = new BuildingRadar(spatialIndex);

            // Start GPS (requests location permission)
            app.startGPS().then(started => {
                if (started) {
                    console.log('GPS started - location permission granted');
                } else {
                    console.log('GPS failed to start - permission may have been denied');
                }
            });

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