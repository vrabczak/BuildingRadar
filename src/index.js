import './styles.css';
import { BuildingRadar } from './core/BuildingRadar.js';
import { DataLoader } from './core/DataLoader.js';

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
        console.log('Initializing BuildingRadar application...');

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

            const buildingsData = event.detail;
            console.log(`Buildings data loaded: ${buildingsData.features.length} features`);

            // Create and start the application with loaded data
            app = new BuildingRadar(buildingsData);

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
        const hasStoredData = dataLoader.getBuildingsData() !== null;
        if (hasStoredData) {
            console.log('Buildings data restored from previous session');
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