import { StorageConfig } from './SettingsManager.js';

/**
 * SpatialIndex - Grid-based spatial index for fast proximity queries
 * Supports direct IndexedDB serialization for memory-efficient storage
 */
export class SpatialIndex {
    constructor(cellSize = StorageConfig.DEFAULT_CELL_SIZE) { // ~1km at equator
        this.cellSize = cellSize;
        this.grid = new Map(); // cellKey -> [featureIndices]
        this.allFeatures = []; // Legacy: all features in memory
        this.featureCount = 0; // Total count (works in both modes)
        this.isLoaded = false;

        // Lazy loading support
        this.lazyMode = false;
        this.chunkMap = new Map(); // chunkId -> [features]
        this.chunkMetadata = new Map(); // cellKey -> chunkId
        this.chunkBoundaries = []; // Array of {start, end, shapefileName} for variable-sized chunks
        this.featureIndexMap = new Map(); // globalIndex -> {chunkId, localIndex} for O(1) lookup
        this.loadedChunks = new Set(); // Set of loaded chunkIds
        this.chunkCache = []; // LRU cache: [{id, lastAccess}]
        this.maxCachedChunks = StorageConfig.MAX_CACHED_CHUNKS; // Keep N chunks in memory
        this.chunkLoader = null; // Function to load chunk by ID
    }

    /**
     * Get grid cell key for coordinates
     */
    getCellKey(lon, lat) {
        const cellX = Math.floor(lon / this.cellSize);
        const cellY = Math.floor(lat / this.cellSize);
        return `${cellX},${cellY}`;
    }

    /**
     * Parse cell key string to coordinates
     * @param {string} cellKey - Cell key in format "x,y"
     * @returns {Array<number>} [x, y] coordinates
     */
    parseCellKey(cellKey) {
        const [x, y] = cellKey.split(',').map(Number);
        return [x, y];
    }

    /**
     * Calculate distance between two points using Haversine formula
     * @param {number} lat1 - Latitude of first point
     * @param {number} lon1 - Longitude of first point
     * @param {number} lat2 - Latitude of second point
     * @param {number} lon2 - Longitude of second point
     * @returns {number} Distance in meters
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Index all features from GeoJSON
     */
    indexFeatures(geojson) {
        console.log('Building spatial index...');
        const startTime = performance.now();

        this.allFeatures = geojson.features;
        this.featureCount = geojson.features.length;
        this.grid.clear();

        geojson.features.forEach((feature, index) => {
            if (feature.geometry.type === 'Point') {
                const [lon, lat] = feature.geometry.coordinates;
                const key = this.getCellKey(lon, lat);

                if (!this.grid.has(key)) {
                    this.grid.set(key, []);
                }
                this.grid.get(key).push(index);
            }
        });

        const endTime = performance.now();
        console.log(`Spatial index built in ${(endTime - startTime).toFixed(2)}ms`);
        console.log(`Grid cells: ${this.grid.size}, Features: ${this.featureCount}`);
    }

    /**
     * Query all features within radius of a point
     * In lazy mode, automatically loads required chunks
     */
    async queryRadius(lon, lat, radius) {
        const features = [];
        const centerKey = this.getCellKey(lon, lat);
        const [centerCellX, centerCellY] = this.parseCellKey(centerKey);

        // Calculate grid cell range to check
        const cellRange = Math.ceil(radius / (this.cellSize * 111000)); // Approximate degrees

        console.log(`🔍 Query at [${lat.toFixed(6)}, ${lon.toFixed(6)}], radius=${radius}m, cellRange=${cellRange}`);

        // Collect needed chunks in lazy mode (based on degree tiles)
        if (this.lazyMode) {
            const neededChunks = new Set();

            // Get current degree tile
            const currentTile = this.getDegreeTile(lon, lat);
            const [tileLat, tileLon] = currentTile.split(',').map(Number);

            console.log(`🔍 Current position: [${lat.toFixed(6)}, ${lon.toFixed(6)}] → tile ${currentTile}`);

            // DEBUG: Load ONLY current tile (neighbors disabled for debugging)
            const tilesToLoad = [];
            const checkTile = currentTile; // Only current tile
            const chunkId = this.chunkMetadata.get(checkTile);

            if (chunkId !== undefined) {
                neededChunks.add(chunkId);
                tilesToLoad.push(checkTile);
            }

            // DISABLED FOR DEBUGGING: Load current tile + 8 neighbors (3x3 grid)
            // for (let dLat = -1; dLat <= 1; dLat++) {
            //     for (let dLon = -1; dLon <= 1; dLon++) {
            //         const checkTile = `${tileLat + dLat},${tileLon + dLon}`;
            //         const chunkId = this.chunkMetadata.get(checkTile);
            //         if (chunkId !== undefined) {
            //             neededChunks.add(chunkId);
            //             tilesToLoad.push(checkTile);
            //         }
            //     }
            // }

            console.log(`📍 Tiles to load: [${tilesToLoad.join(', ')}]`);
            console.log(`📦 Need ${neededChunks.size} chunks for this query: [${Array.from(neededChunks).join(', ')}]`);

            // Load needed chunks
            await this.ensureChunksLoaded(Array.from(neededChunks));
        }

        // Query features from loaded data
        for (let dx = -cellRange; dx <= cellRange; dx++) {
            for (let dy = -cellRange; dy <= cellRange; dy++) {
                // Calculate neighbor cell using cell indices
                const checkKey = `${centerCellX + dx},${centerCellY + dy}`;

                const indices = this.grid.get(checkKey);
                if (indices) {
                    for (const idx of indices) {
                        const feature = this.getFeature(idx);
                        if (feature) {
                            const [fLon, fLat] = feature.geometry.coordinates;
                            const distance = this.calculateDistance(lat, lon, fLat, fLon);

                            if (distance <= radius) {
                                features.push({
                                    ...feature,
                                    distance
                                });
                            }
                        }
                    }
                }
            }
        }

        console.log('✅ Found ' + features.length + ' buildings within ' + radius + 'm');

        return features;
    }

    /**
     * Get total number of indexed features
     */
    getFeatureCount() {
        return this.lazyMode ? this.featureCount : this.allFeatures.length;
    }

    /**
     * Clear the index
     */
    clear() {
        this.grid.clear();
        this.allFeatures = [];
        this.isLoaded = false;
    }

    /**
     * Add a single feature to the index (for streaming/chunked loading)
     */
    addFeature(feature) {
        if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            const key = this.getCellKey(lon, lat);

            const index = this.allFeatures.length;
            this.allFeatures.push(feature);

            if (!this.grid.has(key)) {
                this.grid.set(key, []);
            }
            this.grid.get(key).push(index);
        }
    }

    /**
     * Serialize to plain object for IndexedDB storage
     * Chunk boundaries define how features are grouped (by shapefile)
     * @param {Array} chunkBoundaries - Array of chunk boundaries {start, end, shapefileName}
     */
    serialize(chunkBoundaries) {
        if (!chunkBoundaries || chunkBoundaries.length === 0) {
            throw new Error('serialize() requires chunkBoundaries parameter');
        }

        // Convert Map to plain object with array values
        const gridObject = {};
        for (const [key, indices] of this.grid.entries()) {
            gridObject[key] = indices;
        }

        // Build chunk metadata: map grid cells to chunk IDs based on shapefile boundaries
        const chunkMetadata = this.buildChunkMetadataFromBoundaries(chunkBoundaries);

        // Store chunk boundaries on the instance for immediate use
        this.chunkBoundaries = chunkBoundaries;

        // Set chunk metadata on the instance so it can be used immediately
        this.setChunkMetadata(chunkMetadata);

        return {
            cellSize: this.cellSize,
            grid: gridObject,
            featureCount: this.allFeatures.length,
            chunkMetadata: chunkMetadata,
            chunkBoundaries: chunkBoundaries, // Save boundaries for variable-sized chunks
            // Features stored separately in chunks
        };
    }

    /**
     * Build chunk metadata from explicit chunk boundaries
     * Uses degree tiles from shapefile names (e.g., n48e022 -> "48,22")
     * @param {Array} chunkBoundaries - Array of {start, end, shapefileName} objects
     * @returns {Object} chunkMetadata mapping degreeTile -> chunkId
     */
    buildChunkMetadataFromBoundaries(chunkBoundaries) {
        const chunkMetadata = {};

        // Extract degree tile from each shapefile name
        for (let chunkId = 0; chunkId < chunkBoundaries.length; chunkId++) {
            const { shapefileName } = chunkBoundaries[chunkId];
            const tileKey = this.extractDegreeTileFromName(shapefileName);

            if (tileKey) {
                chunkMetadata[tileKey] = chunkId;
                console.log(`  📍 Chunk ${chunkId}: ${shapefileName} → tile ${tileKey}`);
            } else {
                console.warn(`⚠️ Could not extract tile from shapefile name: ${shapefileName}`);
            }
        }

        console.log(`🗺️ Generated chunk metadata for ${Object.keys(chunkMetadata).length} degree tiles`);
        return chunkMetadata;
    }

    /**
     * Extract degree tile key from shapefile name (e.g., "n48e022" -> "48,22")
     * @param {string} shapefileName - Shapefile name
     * @returns {string|null} Tile key or null if parsing fails
     */
    extractDegreeTileFromName(shapefileName) {
        // Match patterns like: n48e022, s12w034, N48E022, etc.
        const match = shapefileName.match(/([ns])(\d+)([ew])(\d+)/i);
        if (!match) return null;

        const [, latDir, latDeg, lonDir, lonDeg] = match;
        const lat = parseInt(latDeg) * (latDir.toLowerCase() === 's' ? -1 : 1);
        const lon = parseInt(lonDeg) * (lonDir.toLowerCase() === 'w' ? -1 : 1);

        return `${lat},${lon}`;
    }

    /**
     * Get degree tile key for coordinates (integer degrees)
     */
    getDegreeTile(lon, lat) {
        const tileLat = Math.floor(lat);
        const tileLon = Math.floor(lon);
        return `${tileLat},${tileLon}`;
    }

    /**
     * Serialize features in chunks for memory-efficient storage
     * @param {number} chunkSize - Number of features per chunk
     * @returns {Array} Array of feature chunks
     */
    serializeFeatures(chunkSize = StorageConfig.CHUNK_SIZE) {
        const chunks = [];
        for (let i = 0; i < this.allFeatures.length; i += chunkSize) {
            chunks.push(this.allFeatures.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Deserialize from IndexedDB storage
     * @param {Object} data - Serialized index data
     */
    deserialize(data) {
        this.cellSize = data.cellSize;
        this.featureCount = data.featureCount || 0; // Restore feature count

        // Convert plain object back to Map
        this.grid.clear();
        for (const [key, indices] of Object.entries(data.grid)) {
            this.grid.set(key, indices);
        }

        // Set chunk metadata for lazy loading
        if (data.chunkMetadata) {
            this.setChunkMetadata(data.chunkMetadata);
        }

        // Features loaded separately (or on-demand in lazy mode)
        this.isLoaded = true;
    }

    /**
     * Load features from chunks
     * @param {Array} chunks - Array of feature chunks
     */
    loadFeatureChunks(chunks) {
        this.allFeatures = [];
        for (const chunk of chunks) {
            this.allFeatures.push(...chunk);
        }
        this.featureCount = this.allFeatures.length;
        console.log(`Loaded ${this.featureCount} features from ${chunks.length} chunks`);
    }

    /**
     * Get feature by index (handles lazy loading)
     */
    getFeature(index) {
        if (this.lazyMode) {
            // Find which variable-sized chunk contains this feature index
            let chunkId = -1;
            let localIndex = -1;

            // Use chunk boundaries if available (variable-sized chunks)
            if (this.chunkBoundaries && this.chunkBoundaries.length > 0) {
                for (let i = 0; i < this.chunkBoundaries.length; i++) {
                    const { start, end } = this.chunkBoundaries[i];
                    if (index >= start && index < end) {
                        chunkId = i;
                        localIndex = index - start;
                        break;
                    }
                }
            } else {
                // Fallback to fixed-size chunks
                const chunkSize = StorageConfig.CHUNK_SIZE;
                chunkId = Math.floor(index / chunkSize);
                localIndex = index % chunkSize;
            }

            // Debug: Log first few getFeature attempts
            if (!this._getFeatureCallCount) this._getFeatureCallCount = 0;
            if (this._getFeatureCallCount < 5) {
                console.log(`📄 getFeature(${index}): chunkId=${chunkId}, localIndex=${localIndex}, loaded=${this.loadedChunks.has(chunkId)}`);
                if (chunkId >= 0 && this.loadedChunks.has(chunkId)) {
                    const features = this.chunkMap.get(chunkId);
                    console.log(`  → Chunk ${chunkId} has ${features?.length || 0} features, getting index ${localIndex}`);
                }
                this._getFeatureCallCount++;
            }

            // Check if chunk is loaded
            if (chunkId >= 0 && this.loadedChunks.has(chunkId)) {
                const features = this.chunkMap.get(chunkId);
                return features ? features[localIndex] : null;
            }
            return null;
        }
        return this.allFeatures[index];
    }

    /**
     * Enable lazy loading mode
     */
    enableLazyLoading(chunkLoader) {
        this.lazyMode = true;
        this.chunkLoader = chunkLoader;
        console.log('Lazy loading enabled with chunk loader');
    }

    /**
     * Ensure required chunks are loaded
     */
    async ensureChunksLoaded(chunkIds) {
        const toLoad = chunkIds.filter(id => !this.loadedChunks.has(id));

        if (toLoad.length > 0 && this.chunkLoader) {
            console.log(`🔽 Loading ${toLoad.length} chunks: [${toLoad.join(', ')}]...`);
            const chunks = await this.chunkLoader(toLoad);
            console.log(`📦 Received ${chunks.length} chunks from storage`);

            for (const { id, features } of chunks) {
                if (!features) {
                    console.warn(`⚠️ Chunk ${id} has no features!`);
                    continue;
                }
                console.log(`  ✓ Chunk ${id}: ${features.length} features loaded`);
                this.chunkMap.set(id, features);
                this.loadedChunks.add(id);
                this.updateChunkCache(id);
            }

            console.log(`✅ Chunks in memory: ${this.loadedChunks.size}, chunkMap size: ${this.chunkMap.size}`);

            // Evict old chunks if cache is full
            this.evictOldChunks();
        } else if (toLoad.length === 0) {
            console.log(`♻️ All ${chunkIds.length} chunks already loaded`);
            // Just update access time for already loaded chunks
            chunkIds.forEach(id => {
                if (this.loadedChunks.has(id)) {
                    this.updateChunkCache(id);
                }
            });
        }
    }

    /**
     * Update LRU cache
     */
    updateChunkCache(chunkId) {
        const now = Date.now();
        const existing = this.chunkCache.find(c => c.id === chunkId);

        if (existing) {
            existing.lastAccess = now;
        } else {
            this.chunkCache.push({ id: chunkId, lastAccess: now });
        }
    }

    /**
     * Evict least recently used chunks
     */
    evictOldChunks() {
        if (this.chunkCache.length <= this.maxCachedChunks) return;

        // Sort by last access time
        this.chunkCache.sort((a, b) => a.lastAccess - b.lastAccess);

        // Remove oldest chunks
        const toRemove = this.chunkCache.splice(0, this.chunkCache.length - this.maxCachedChunks);

        for (const { id } of toRemove) {
            this.chunkMap.delete(id);
            this.loadedChunks.delete(id);
        }

        console.log(`Evicted ${toRemove.length} chunks from cache`);
    }

    /**
     * Prefetch neighboring chunks for smooth movement
     */
    prefetchNeighboringChunks(centerKey, range) {
        if (!this.lazyMode || !this.chunkLoader) return;

        const [centerX, centerY] = this.parseCellKey(centerKey);
        const prefetchChunks = new Set();

        // Prefetch chunks in larger radius
        const prefetchRange = range + 2;

        for (let dx = -prefetchRange; dx <= prefetchRange; dx++) {
            for (let dy = -prefetchRange; dy <= prefetchRange; dy++) {
                const checkKey = this.getCellKey(
                    centerX + dx * this.cellSize,
                    centerY + dy * this.cellSize
                );
                const chunkId = this.chunkMetadata.get(checkKey);
                if (chunkId !== undefined && !this.loadedChunks.has(chunkId)) {
                    prefetchChunks.add(chunkId);
                }
            }
        }

        // Load in background (don't await)
        if (prefetchChunks.size > 0) {
            this.ensureChunksLoaded(Array.from(prefetchChunks)).catch(err => {
                console.warn('Prefetch failed:', err);
            });
        }
    }

    /**
     * Set chunk metadata for lazy loading
     */
    setChunkMetadata(chunkMetadata) {
        this.chunkMetadata = new Map(Object.entries(chunkMetadata));
        console.log(`Chunk metadata loaded: ${this.chunkMetadata.size} grid cells mapped to chunks`);
    }

    /**
     * Get index metadata
     */
    getMetadata() {
        return {
            cellSize: this.cellSize,
            gridCells: this.grid.size,
            featureCount: this.allFeatures.length,
            isLoaded: this.isLoaded,
            lazyMode: this.lazyMode,
            loadedChunks: this.loadedChunks.size,
            cachedChunks: this.chunkCache.length
        };
    }
}
