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
     * Process multiple shapefiles from a folder
     * Groups related files (.shp, .dbf, .shx) and processes them incrementally
     * Returns features organized by shapefile for optimal chunking
     * @param {FileList} files - List of files from folder upload
     * @returns {Promise<Object>} Object with featuresByShapefile array and combined GeoJSON
     */
    async loadShapefilesFromFolder(files) {
        // Group files by shapefile name
        const shapefileGroups = this.groupShapefilesByName(files);
        console.log(`Found ${shapefileGroups.length} shapefiles in folder`);

        if (shapefileGroups.length === 0) {
            throw new Error('No valid shapefiles found in the selected folder');
        }

        // Store features grouped by shapefile (for spatial chunking)
        const featuresByShapefile = [];

        // Combined GeoJSON structure (for backward compatibility)
        const combinedGeoJSON = {
            type: 'FeatureCollection',
            features: []
        };

        // Process each shapefile group incrementally to avoid memory spikes
        for (let i = 0; i < shapefileGroups.length; i++) {
            const group = shapefileGroups[i];
            this.updateProgress(`Processing shapefile ${i + 1}/${shapefileGroups.length}: ${group.name}`, 'loading');
            console.log(`📂 Processing shapefile ${i + 1}/${shapefileGroups.length}: ${group.name}`);

            try {
                // Parse this shapefile
                const geojson = await this.parseShapefileGroup(group);

                if (geojson && geojson.features && geojson.features.length > 0) {
                    // Tag each feature with its source shapefile (for debugging/tracking)
                    const taggedFeatures = geojson.features.map(feature => ({
                        ...feature,
                        properties: {
                            ...feature.properties,
                            _sourceShapefile: group.name
                        }
                    }));

                    // Store features grouped by shapefile
                    featuresByShapefile.push({
                        shapefileName: group.name,
                        features: taggedFeatures,
                        chunkIndex: i // Will be used as chunk ID
                    });

                    // Add to combined collection
                    // Avoid using spread syntax with very large arrays which
                    // causes "Maximum call stack size exceeded" errors when
                    // the browser attempts to apply each element as an
                    // argument to Array.prototype.push. Some of our
                    // shapefiles contain hundreds of thousands of features,
                    // so we append incrementally instead. This still preserves
                    // chunk boundaries because each feature is appended in the
                    // original order.
                    for (const feature of taggedFeatures) {
                        combinedGeoJSON.features.push(feature);
                    }
                    console.log(`  ✓ Added ${taggedFeatures.length} features (total: ${combinedGeoJSON.features.length})`);
                }

                // Give browser time to process between files (especially on mobile)
                if (DeviceUtils.isMobileDevice()) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.warn(`  ⚠️ Skipping ${group.name}: ${error.message}`);
                // Continue with next file instead of failing completely
            }
        }

        if (combinedGeoJSON.features.length === 0) {
            throw new Error('No features could be loaded from any shapefile');
        }

        console.log(`✅ Successfully loaded ${combinedGeoJSON.features.length} features from ${shapefileGroups.length} shapefiles`);

        return {
            featuresByShapefile: featuresByShapefile,
            combinedGeoJSON: combinedGeoJSON
        };
    }

    /**
     * Group files by shapefile base name
     * Each shapefile needs .shp, and optionally .dbf, .shx, .prj files
     */
    groupShapefilesByName(files) {
        const groups = new Map();

        // First pass: find all .shp files
        for (const file of files) {
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.shp')) {
                const baseName = fileName.slice(0, -4);
                const fullPath = file.webkitRelativePath || file.name;
                const pathParts = fullPath.split('/');
                const baseNameWithPath = pathParts.slice(0, -1).join('/') + '/' + baseName;

                if (!groups.has(baseNameWithPath)) {
                    groups.set(baseNameWithPath, {
                        name: baseName,
                        fullPath: baseNameWithPath,
                        files: {}
                    });
                }
                groups.get(baseNameWithPath).files.shp = file;
            }
        }

        // Second pass: add associated files (.dbf, .shx, .prj)
        for (const file of files) {
            const fileName = file.name.toLowerCase();
            const fullPath = file.webkitRelativePath || file.name;
            const pathParts = fullPath.split('/');

            for (const ext of ['.dbf', '.shx', '.prj']) {
                if (fileName.endsWith(ext)) {
                    const baseName = fileName.slice(0, -4);
                    const baseNameWithPath = pathParts.slice(0, -1).join('/') + '/' + baseName;

                    if (groups.has(baseNameWithPath)) {
                        const extName = ext.slice(1); // Remove the dot
                        groups.get(baseNameWithPath).files[extName] = file;
                    }
                    break;
                }
            }
        }

        // Convert to array and filter complete groups (must have .shp)
        const result = Array.from(groups.values()).filter(group => group.files.shp);

        // Log what we found
        result.forEach(group => {
            const fileTypes = Object.keys(group.files).join(', ');
            console.log(`  Found: ${group.name} (${fileTypes})`);
        });

        return result;
    }

    /**
     * Parse a grouped shapefile (with .shp, .dbf, .shx files)
     */
    async parseShapefileGroup(group) {
        // Read all file buffers
        const buffers = {};

        for (const [ext, file] of Object.entries(group.files)) {
            // shpjs only expects: shp, dbf, prj (NOT shx)
            // The .shx file is used internally by the .shp format
            if (ext !== 'shx') {
                buffers[ext] = await this.readFileAsArrayBuffer(file);
            }
        }

        // Debug: log what we're passing to shpjs
        console.log(`  Buffers to parse: ${Object.keys(buffers).join(', ')}`);

        // Load shpjs module
        const shp = await import('shpjs');

        // Use shpjs's low-level API for separate files:
        // parseShp(shpBuffer, prjString), parseDbf(dbfBuffer), then combine
        const parsePromises = [];

        // Parse .shp file (with optional .prj for projection)
        if (buffers.shp) {
            // If we have a .prj file, convert it to string for parseShp
            const prjString = buffers.prj ? new TextDecoder().decode(buffers.prj) : undefined;
            parsePromises.push(shp.default.parseShp(buffers.shp, prjString));
        }

        // Parse .dbf file (attribute data)
        if (buffers.dbf) {
            parsePromises.push(shp.default.parseDbf(buffers.dbf));
        }

        // Parse both files in parallel
        const results = await Promise.all(parsePromises);

        // Manually combine to avoid stack overflow on large files
        // results[0] = geometries from .shp, results[1] = properties from .dbf
        const geometries = results[0];
        const properties = results.length > 1 ? results[1] : null;

        // Create GeoJSON by merging geometry and properties
        const features = [];
        for (let i = 0; i < geometries.length; i++) {
            features.push({
                type: 'Feature',
                geometry: geometries[i],
                properties: properties && properties[i] ? properties[i] : {}
            });
        }

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        return geojson;
    }

    /**
     * Read a file as ArrayBuffer
     */
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
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