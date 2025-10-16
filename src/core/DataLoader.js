/**
 * DataLoader - Handles loading and parsing of shapefile data with progress tracking
 */
export class DataLoader {
    constructor() {
        this.buildingsData = null;
        this.fileInput = document.getElementById('shapefileInput');
        this.fileStatus = document.getElementById('fileStatus');
        this.modal = document.getElementById('fileInputModal');

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.showStatus('Reading file...', 'loading');

        try {
            const data = await this.loadShapefile(file);

            this.showStatus('Processing data...', 'loading');
            this.buildingsData = this.convertToGeoJSON(data);

            const featureCount = this.buildingsData.features.length;
            this.showStatus(`✓ Loaded ${featureCount} buildings successfully!`, 'success');

            setTimeout(() => {
                this.hideModal();
                window.dispatchEvent(new CustomEvent('buildingsLoaded', {
                    detail: this.buildingsData
                }));
            }, 1000);
        } catch (error) {
            console.error('Error loading shapefile:', error);
            this.showStatus(`✗ Error: ${error.message}`, 'error');
        }
    }

    async loadShapefile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            // Track file reading progress
            reader.onprogress = (e) => {
                if (e.lengthComputable) {
                    const mbLoaded = (e.loaded / 1024 / 1024).toFixed(1);
                    const mbTotal = (e.total / 1024 / 1024).toFixed(1);
                    this.showStatus(`Reading file... ${mbLoaded} / ${mbTotal} MB`, 'loading');
                }
            };

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    console.log('File loaded, size:', arrayBuffer.byteLength, 'bytes');
                    console.log('File type:', file.type, 'Name:', file.name);

                    this.showStatus('Loading parser...', 'loading');
                    const shpModule = await import('shpjs');
                    console.log('shpjs module loaded');

                    this.showStatus('Parsing shapefile (please wait)...', 'loading');
                    const geojson = await shpModule.default(arrayBuffer);

                    console.log('GeoJSON parsed:', geojson);

                    resolve(geojson);
                } catch (error) {
                    console.error('Shapefile parsing error:', error);
                    reject(new Error(`Failed to parse shapefile: ${error.message}`));
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    convertToGeoJSON(data) {
        // Shapefile already contains point geometries (centroids)
        return data;
    }

    showStatus(message, type) {
        this.fileStatus.textContent = message;
        this.fileStatus.className = `file-status ${type}`;
    }

    hideModal() {
        this.modal.classList.add('hidden');
    }

    showModal() {
        this.modal.classList.remove('hidden');
    }

    getBuildingsData() {
        return this.buildingsData;
    }
}
