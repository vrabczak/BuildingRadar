import { DeviceUtils } from './DeviceUtils.js';

/**
 * FileProcessor - Handles shapefile loading and parsing operations
 */
export class FileProcessor {
    constructor(onProgress = null) {
        this.onProgress = onProgress; // Callback for progress updates
    }

    /**
     * Load and parse shapefile
     */
    async loadShapefile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            // Track file reading progress
            reader.onprogress = (e) => {
                if (e.lengthComputable) {
                    const mbLoaded = (e.loaded / 1024 / 1024).toFixed(1);
                    const mbTotal = (e.total / 1024 / 1024).toFixed(1);
                    this.updateProgress(`Reading file... ${mbLoaded} / ${mbTotal} MB`, 'loading');
                }
            };

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    console.log('File loaded, size:', arrayBuffer.byteLength, 'bytes');
                    console.log('File type:', file.type, 'Name:', file.name);
                    console.log('Memory after file read:', DeviceUtils.checkMemory());

                    // Check if we have enough memory for parsing (rough heuristic)
                    if (DeviceUtils.isMobileDevice() && arrayBuffer.byteLength > 20 * 1024 * 1024) {
                        console.warn('⚠️ Large file on mobile - proceeding with caution');
                        // Give browser time to stabilize
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    this.updateProgress('Loading parser...', 'loading');
                    let shpModule;
                    try {
                        shpModule = await import('shpjs');
                        console.log('shpjs module loaded');
                    } catch (importError) {
                        console.error('Failed to load shpjs module:', importError);
                        throw new Error('Failed to load shapefile parser library');
                    }

                    this.updateProgress('Parsing shapefile (please wait)...', 'loading');
                    console.log('Starting shapefile parse...');

                    let geojson;
                    try {
                        geojson = await shpModule.default(arrayBuffer);
                        console.log('GeoJSON parsed successfully');
                        console.log('Features:', geojson?.features?.length || 0);
                        console.log('Memory after parse:', DeviceUtils.checkMemory());
                    } catch (parseError) {
                        console.error('Shapefile parsing failed:', parseError);
                        throw new Error(`Parsing failed: ${parseError.message}`);
                    }

                    resolve(geojson);
                } catch (error) {
                    console.error('Shapefile loading error:', error);
                    console.error('Error stack:', error.stack);
                    reject(new Error(`Failed to parse shapefile: ${error.message}`));
                }
            };

            reader.onerror = (error) => {
                console.error('FileReader error:', error);
                reject(new Error('Failed to read file'));
            };

            try {
                reader.readAsArrayBuffer(file);
            } catch (error) {
                console.error('Failed to start file read:', error);
                reject(new Error('Failed to start reading file'));
            }
        });
    }

    /**
     * Convert data to GeoJSON (shapefile already contains point geometries)
     */
    convertToGeoJSON(data) {
        return data;
    }

    /**
     * Update progress via callback
     */
    updateProgress(message, type) {
        if (this.onProgress) {
            this.onProgress(message, type);
        }
    }

    /**
     * Create file metadata
     */
    createMetadata(file) {
        return {
            filename: file.name,
            filesize: file.size,
            filetype: file.type,
            uploadDate: new Date().toISOString()
        };
    }
}