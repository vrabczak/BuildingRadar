import './styles.css';
import { BuildingRadar } from './core/BuildingRadar.js';
import buildingsData from '../dist/buildings.geojson';

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

function initApp() {
    try {
        console.log('Initializing BuildingRadar application...');

        // Create and start the application
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