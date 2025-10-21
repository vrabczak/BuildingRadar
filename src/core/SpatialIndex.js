/**
 * SpatialIndex - Grid-based spatial index for fast proximity queries
 * Supports direct IndexedDB serialization for memory-efficient storage
 */
export class SpatialIndex {
    constructor(cellSize = 0.01) { // ~1km at equator
        this.cellSize = cellSize;
        this.grid = new Map(); // cellKey -> [featureIndices]
        this.allFeatures = []; // Legacy: all features in memory
        this.featureCount = 0; // Total count (works in both modes)
        this.isLoaded = false;

        // Lazy loading support
        this.lazyMode = false;
        this.chunkMap = new Map(); // chunkId -> [features]
        this.chunkMetadata = new Map(); // cellKey -> chunkId
        this.loadedChunks = new Set(); // Set of loaded chunkIds
        this.chunkCache = []; // LRU cache: [{id, lastAccess}]
        this.maxCachedChunks = 10; // Keep 10 chunks in memory
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

        // Collect needed chunks in lazy mode
        if (this.lazyMode) {
            const neededChunks = new Set();
            for (let dx = -cellRange; dx <= cellRange; dx++) {
                for (let dy = -cellRange; dy <= cellRange; dy++) {
                    // Calculate neighbor cell using cell indices
                    const checkKey = `${centerCellX + dx},${centerCellY + dy}`;
                    const chunkId = this.chunkMetadata.get(checkKey);
                    if (chunkId !== undefined) {
                        neededChunks.add(chunkId);
                    }
                }
            }

            console.log(`📦 Need ${neededChunks.size} chunks for this query`);

            // Load needed chunks
            await this.ensureChunksLoaded(Array.from(neededChunks));

            // Prefetch neighboring chunks for smooth movement
            this.prefetchNeighboringChunks(centerKey, cellRange);
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
     * Returns chunked data to avoid memory spikes
     */
    serialize() {
        // Convert Map to plain object with array values
        const gridObject = {};
        for (const [key, indices] of this.grid.entries()) {
            gridObject[key] = indices;
        }

        // Build chunk metadata: map grid cells to chunk IDs
        const chunkMetadata = {};
        let currentChunk = 0;
        const chunkSize = 10000;

        for (const [key, indices] of this.grid.entries()) {
            // Determine which chunk(s) this cell's features belong to
            const chunkIds = new Set();
            for (const idx of indices) {
                const chunkId = Math.floor(idx / chunkSize);
                chunkIds.add(chunkId);
            }
            // For simplicity, assign to first chunk (most features will be in one)
            chunkMetadata[key] = Math.min(...chunkIds);
        }

        return {
            cellSize: this.cellSize,
            grid: gridObject,
            featureCount: this.allFeatures.length,
            chunkMetadata: chunkMetadata,
            // Features stored separately in chunks
        };
    }

    /**
     * Serialize features in chunks for memory-efficient storage
     * @param {number} chunkSize - Number of features per chunk
     * @returns {Array} Array of feature chunks
     */
    serializeFeatures(chunkSize = 10000) {
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
            // In lazy mode, search in loaded chunks
            for (const [chunkId, features] of this.chunkMap.entries()) {
                if (this.loadedChunks.has(chunkId)) {
                    const feature = features[index];
                    if (feature) return feature;
                }
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
            console.log(`Loading ${toLoad.length} chunks...`);
            const chunks = await this.chunkLoader(toLoad);

            for (const { id, features } of chunks) {
                this.chunkMap.set(id, features);
                this.loadedChunks.add(id);
                this.updateChunkCache(id);
            }

            // Evict old chunks if cache is full
            this.evictOldChunks();
        } else {
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
