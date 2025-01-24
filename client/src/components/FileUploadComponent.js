import React, { useState } from 'react';
import axios from 'axios';
import './FileUploadComponent.css';

const FileUploadComponent = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [sensitiveData, setSensitiveData] = useState([]);
  const [processedFiles, setProcessedFiles] = useState({
    highlighted: null,
    masked: null,
    format: null
  });

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setSelectedFile(file);
    setUploadStatus('');
    setSensitiveData([]);
    setProcessedFiles({ highlighted: null, masked: null, format: null });
  };

  const handleFileUpload = async () => {
    if (!selectedFile) {
      setUploadStatus('Please select a file before submitting.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      setUploadStatus('Uploading...');
      const response = await axios.post('http://localhost:8888/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        withCredentials: true
      });

      setUploadStatus('Upload successful!');
      setSensitiveData(response.data.matchedPatterns);
      setProcessedFiles({
        highlighted: response.data.highlightedFile,
        masked: response.data.maskedFile,
        format: response.data.originalFormat
      });
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus('Upload failed. Please try again.');
      setSensitiveData([]);
      setProcessedFiles({ highlighted: null, masked: null, format: null });
    }
  };

  const handleFileView = (fileType) => {
    const filename = fileType === 'highlighted' ? 
      processedFiles.highlighted : processedFiles.masked;
    window.open(`http://localhost:8888/view/${filename}`, '_blank');
  };

  const handleFileDownload = async (fileType) => {
    const filename = fileType === 'highlighted' ? 
      processedFiles.highlighted : processedFiles.masked;
    
    try {
      const response = await axios.get(
        `http://localhost:8888/download/${filename}`,
        { 
          responseType: 'blob',
          withCredentials: true
        }
      );
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Use original file extension
      const originalName = selectedFile.name;
      const baseName = originalName.substring(0, originalName.lastIndexOf('.'));
      const extension = `.${processedFiles.format}`;
      link.setAttribute('download', `${baseName}_${fileType}${extension}`);
      
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      setUploadStatus('Download failed. Please try again.');
    }
  };

  const getFileTypeLabel = (format) => {
    switch (format) {
      case 'pdf':
        return 'PDF Document';
      case 'docx':
        return 'Word Document';
      case 'xlsx':
        return 'Excel Spreadsheet';
      default:
        return 'Document';
    }
  };

  return (
    <div className="file-upload-container">
      <h2 className="upload-title">Data Loss Prevention (DLP) Scanner</h2>
      
      <div className="file-input-container">
        <input
          type="file"
          onChange={handleFileChange}
          accept=".pdf,.docx,.xlsx"
          className="file-upload-input"
        />
        <button
          onClick={handleFileUpload}
          className="file-upload-button"
          disabled={!selectedFile}
        >
          Upload File
        </button>
      </div>

      {selectedFile && (
        <div className="file-details">
          <p><strong>Selected File:</strong> {selectedFile.name}</p>
          <p><strong>File Size:</strong> {(selectedFile.size / 1024).toFixed(2)} KB</p>
          <p><strong>File Type:</strong> {getFileTypeLabel(selectedFile.name.split('.').pop())}</p>
        </div>
      )}

      {uploadStatus && (
        <div className={`upload-status ${uploadStatus.includes('failed') ? 'error' : ''}`}>
          {uploadStatus}
        </div>
      )}

      {sensitiveData.length > 0 && (
        <div className="results-container">
          <div className="sensitive-data-container">
            <h3>Detected Sensitive Data:</h3>
            <ul className="sensitive-data-list">
              {sensitiveData.map((item, index) => (
                <li key={index} className="sensitive-data-item">
                  <strong>{item.pattern}:</strong> {item.match}
                </li>
              ))}
            </ul>
          </div>

          <div className="processed-files-container">
            <h3>Processed Files:</h3>
            <div className="file-actions">
              <div className="action-group">
                <h4>Highlighted Version</h4>
                <p>View the document with sensitive data highlighted</p>
                <div className="button-group">
                  <button onClick={() => handleFileView('highlighted')} className="view-button">
                    View Online
                  </button>
                  <button onClick={() => handleFileDownload('highlighted')} className="download-button">
                    Download
                  </button>
                </div>
              </div>

              <div className="action-group">
                <h4>Masked Version</h4>
                <p>View the document with sensitive data masked</p>
                <div className="button-group">
                  <button onClick={() => handleFileView('masked')} className="view-button">
                    View Online
                  </button>
                  <button onClick={() => handleFileDownload('masked')} className="download-button">
                    Download
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUploadComponent;
