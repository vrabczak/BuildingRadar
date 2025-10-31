/**
 * FileModalUI - Manages the file upload modal UI and user interactions
 */
export class FileModalUI {
    constructor() {
        // Initialize DOM elements
        this.modal = document.getElementById('fileInputModal');
        this.fileInput = document.getElementById('shapefileInput');
        this.fileStatus = document.getElementById('fileStatus');

        // View containers
        this.choiceView = document.getElementById('choiceView');
        this.uploadView = document.getElementById('uploadView');
        this.modalLoading = document.getElementById('modalLoading');
        this.choiceContent = document.getElementById('choiceContent');

        // Buttons
        this.restoreDataBtn = document.getElementById('restoreDataBtn');
        this.uploadNewBtn = document.getElementById('uploadNewBtn');
        this.backToChoiceBtn = document.getElementById('backToChoiceBtn');

        // Info elements
        this.savedDataInfo = document.getElementById('savedDataInfo');
        this.uploadWarning = document.getElementById('uploadWarning');

        // Event handlers storage
        this.eventHandlers = {
            restore: null,
            uploadNew: null,
            back: null,
            fileSelect: null
        };

        console.log('FileModalUI elements:', {
            fileInput: !!this.fileInput,
            choiceView: !!this.choiceView,
            uploadView: !!this.uploadView
        });
    }

    /**
     * Setup event listeners with callbacks
     */
    setupEventListeners(handlers) {
        // Restore saved data button
        if (this.restoreDataBtn && handlers.onRestore) {
            this.eventHandlers.restore = async () => {
                console.log('📦 User chose to restore saved data');
                await handlers.onRestore();
            };
            this.restoreDataBtn.addEventListener('click', this.eventHandlers.restore);
        }

        // Upload new file button
        if (this.uploadNewBtn && handlers.onUploadNew) {
            this.eventHandlers.uploadNew = () => {
                console.log('📁 User chose to upload new file');
                handlers.onUploadNew();
            };
            this.uploadNewBtn.addEventListener('click', this.eventHandlers.uploadNew);
        }

        // Back to choice button
        if (this.backToChoiceBtn && handlers.onBack) {
            this.eventHandlers.back = () => {
                handlers.onBack();
            };
            this.backToChoiceBtn.addEventListener('click', this.eventHandlers.back);
        }

        // File input change
        if (this.fileInput && handlers.onFileSelect) {
            this.eventHandlers.fileSelect = (e) => handlers.onFileSelect(e);
            this.fileInput.addEventListener('change', this.eventHandlers.fileSelect);
        }
    }

    /**
     * Update modal UI based on metadata
     */
    async updateUI(metadata) {
        try {
            console.log('updateModalUI started');
            console.log('Metadata retrieved:', metadata ? 'exists' : 'none');

            if (metadata && this.restoreDataBtn && this.savedDataInfo) {
                // Show restore button if data exists
                this.restoreDataBtn.style.display = 'flex';

                // Update subtitle with file/folder info
                let infoText;
                if (metadata.folderName) {
                    // Folder metadata
                    const sizeMB = (metadata.totalSize / 1024 / 1024).toFixed(1);
                    const date = new Date(metadata.uploadDate).toLocaleDateString();
                    infoText = `${metadata.folderName} (${metadata.fileCount} files, ${sizeMB}MB) - ${date}`;
                } else if (metadata.filename) {
                    // Legacy file metadata
                    const sizeMB = (metadata.filesize / 1024 / 1024).toFixed(1);
                    const date = new Date(metadata.uploadDate).toLocaleDateString();
                    infoText = `${metadata.filename} (${sizeMB}MB) - ${date}`;
                } else {
                    infoText = 'Saved data available';
                }
                this.savedDataInfo.textContent = infoText;

                // Show warning in upload view
                if (this.uploadWarning) {
                    this.uploadWarning.style.display = 'block';
                }
            } else {
                // Hide restore button if no data
                if (this.restoreDataBtn) {
                    this.restoreDataBtn.style.display = 'none';
                }

                // Hide warning in upload view
                if (this.uploadWarning) {
                    this.uploadWarning.style.display = 'none';
                }
            }

            // Hide loading indicator and show choice content
            console.log('Hiding loading indicator');
            this.setLoading(false);

            // Always start with choice view
            this.showChoiceView();
            console.log('updateModalUI completed');
        } catch (error) {
            console.error('Error in updateModalUI:', error);
            // Fallback: show UI anyway
            this.setLoading(false);
            this.showChoiceView();
        }
    }

    /**
     * Show/hide loading indicator
     */
    setLoading(isLoading) {
        if (this.modalLoading) {
            this.modalLoading.style.display = isLoading ? 'block' : 'none';
        }
        if (this.choiceContent) {
            this.choiceContent.style.display = isLoading ? 'none' : 'block';
        }
    }

    /**
     * Show the choice view (restore or upload)
     */
    showChoiceView() {
        if (this.choiceView) {
            this.choiceView.style.display = 'block';
        }
        if (this.uploadView) {
            this.uploadView.style.display = 'none';
        }
        // Clear file input
        if (this.fileInput) {
            this.fileInput.value = '';
        }
        this.showStatus('', '');
    }

    /**
     * Show the upload view
     */
    showUploadView() {
        if (this.choiceView) {
            this.choiceView.style.display = 'none';
        }
        if (this.uploadView) {
            this.uploadView.style.display = 'block';
        }
        this.showStatus('', '');
    }

    /**
     * Show status message
     */
    showStatus(message, type) {
        if (this.fileStatus) {
            this.fileStatus.textContent = message;
            this.fileStatus.className = `file-status ${type}`;
        }
    }

    /**
     * Hide modal
     */
    hideModal() {
        if (this.modal) {
            this.modal.classList.add('hidden');
        }
    }

    /**
     * Show modal
     */
    showModal() {
        if (this.modal) {
            this.modal.classList.remove('hidden');
        }
    }

    /**
     * Cleanup event listeners
     */
    destroy() {
        if (this.restoreDataBtn && this.eventHandlers.restore) {
            this.restoreDataBtn.removeEventListener('click', this.eventHandlers.restore);
        }
        if (this.uploadNewBtn && this.eventHandlers.uploadNew) {
            this.uploadNewBtn.removeEventListener('click', this.eventHandlers.uploadNew);
        }
        if (this.backToChoiceBtn && this.eventHandlers.back) {
            this.backToChoiceBtn.removeEventListener('click', this.eventHandlers.back);
        }
        if (this.fileInput && this.eventHandlers.fileSelect) {
            this.fileInput.removeEventListener('change', this.eventHandlers.fileSelect);
        }
    }
}