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
    });
}

/**
 * Initialize the application
 */
let app = null;
let dataLoader = null;

function initApp() {
    try {
        console.log('Initializing BuildingRadar application...');

        // Initialize data loader
        dataLoader = new DataLoader();

        // Wait for buildings data to be loaded
        window.addEventListener('buildingsLoaded', (event) => {
            const buildingsData = event.detail;
            console.log(`Buildings data loaded: ${buildingsData.features.length} features`);

            // Create and start the application with loaded data
            app = new BuildingRadar(buildingsData);

            // Handle page visibility changes
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    console.log('Page hidden - pausing updates');
                    // App continues running but could be optimized
                } else {
                    console.log('Page visible - resuming');
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

        console.log('Waiting for shapefile to be loaded...');
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