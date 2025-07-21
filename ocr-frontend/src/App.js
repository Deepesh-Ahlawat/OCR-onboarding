import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Eye, AlertCircle, CheckCircle, Loader } from 'lucide-react';

// Import the stylesheet. This connects your component to App.css.
import './App.css';

function App() {
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [textractData, setTextractData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [success, setSuccess] = useState('');
  
  const imageRef = useRef(null);
  const fileInputRef = useRef(null);

  // BEST PRACTICE: Clean up the generated Object URL to prevent memory leaks.
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setImageFile(file);
      // Revoke the old URL before creating a new one
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
      setImageUrl(URL.createObjectURL(file));
      setTextractData(null);
      setError('');
      setSuccess('');
      setSelectedBlockId(null);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleAnalyzeClick = async () => {
    if (!imageFile) {
      setError('Please select an image first.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setSelectedBlockId(null);

    const formData = new FormData();
    formData.append('file', imageFile);

    try {
      const response = await fetch('http://127.0.0.1:5001/api/analyze', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`${data.type || 'Error'}: ${data.error || 'Unknown error'}`);
      }
      
      setTextractData(data);
      setSuccess('Document analyzed successfully! Click on table rows to highlight corresponding regions.');
    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
      setTextractData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleBlockClick = (blockId) => {
    setSelectedBlockId(blockId);
  };
  
  const renderBoundingBoxes = () => {
    if (!textractData || !textractData.Blocks || !imageRef.current) return null;

    const { clientWidth, clientHeight } = imageRef.current;
    
    const blocksToDraw = textractData.Blocks.filter(
      block => block.Geometry && (block.BlockType === 'WORD' || block.BlockType === 'CELL' || block.BlockType === 'KEY_VALUE_SET')
    );

    return blocksToDraw.map((block) => {
      const { BoundingBox } = block.Geometry;
      const isSelected = selectedBlockId === block.Id;
      const boxClass = `bounding-box ${isSelected ? 'selected' : ''}`;
      
      const boxStyle = {
        top: `${BoundingBox.Top * clientHeight}px`,
        left: `${BoundingBox.Left * clientWidth}px`,
        width: `${BoundingBox.Width * clientWidth}px`,
        height: `${BoundingBox.Height * clientHeight}px`,
      };

      return (
        <div 
          key={block.Id} 
          className={boxClass}
          style={boxStyle} 
          onClick={() => handleBlockClick(block.Id)} 
        />
      );
    });
  };

  const getTextFromBlock = (block, allBlocks) => {
    let text = '';
    if (block && block.Relationships) {
      block.Relationships.forEach(rel => {
        if (rel.Type === 'CHILD') {
          rel.Ids.forEach(childId => {
            const word = allBlocks.find(b => b.Id === childId);
            if (word && word.BlockType === 'WORD') {
              text += word.Text + ' ';
            }
          });
        }
      });
    }
    return text.trim();
  };

  const renderFormData = () => {
    if (!textractData || !textractData.Blocks) return null;
    
    const allBlocks = textractData.Blocks;
    const keyBlocks = allBlocks.filter(b => b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes.includes('KEY'));

    if (keyBlocks.length === 0) return null;

    return (
      <div className="data-section">
        <h3 className="section-title">
          <FileText size={20} />
          Extracted Form Data
        </h3>
        <table className="results-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {keyBlocks.map(keyBlock => {
              const valueBlock = keyBlock.Relationships?.find(r => r.Type === 'VALUE')?.Ids.map(id => allBlocks.find(b => b.Id === id))[0];
              const keyText = getTextFromBlock(keyBlock, allBlocks);
              const valueText = getTextFromBlock(valueBlock, allBlocks);
              const isSelected = (selectedBlockId === keyBlock.Id || selectedBlockId === valueBlock?.Id);

              return (
                <tr 
                  key={keyBlock.Id} 
                  className={isSelected ? 'selected-row' : ''}
                  onClick={() => handleBlockClick(keyBlock.Id)}
                >
                  <td>{keyText}</td>
                  <td><input type="text" defaultValue={valueText} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };
  
  const renderTableData = () => {
    if (!textractData || !textractData.Blocks) return null;
    
    const allBlocks = textractData.Blocks;
    const tableBlocks = allBlocks.filter(b => b.BlockType === 'TABLE');

    if (tableBlocks.length === 0) return null;

    return (
      <div className="data-section">
        <h3 className="section-title">
          <Eye size={20} />
          Extracted Table Data
        </h3>
        {tableBlocks.map((table) => {
          const cells = table.Relationships.find(r => r.Type === 'CHILD').Ids.map(id => allBlocks.find(b => b.Id === id));
          const maxRows = Math.max(...cells.map(c => c.RowIndex));
          const maxCols = Math.max(...cells.map(c => c.ColumnIndex));
          const grid = Array(maxRows).fill(null).map(() => Array(maxCols).fill(null));

          cells.forEach(cell => {
            if (cell.RowIndex > 0 && cell.ColumnIndex > 0) {
              grid[cell.RowIndex - 1][cell.ColumnIndex - 1] = cell;
            }
          });

          return (
            <table key={table.Id} className="results-table">
              <tbody>
                {grid.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => {
                      const cellText = getTextFromBlock(cell, allBlocks);
                      const isSelected = cell && selectedBlockId === cell.Id;
                      return (
                        <td 
                          key={colIndex} 
                          className={isSelected ? 'selected-row' : ''}
                          onClick={() => cell && handleBlockClick(cell.Id)}
                        >
                          <input type="text" defaultValue={cellText} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
      </div>
    );
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <h1 className="header-title">Document Intelligence Platform</h1>
          <p className="header-subtitle">
            Transform your documents into structured data with AI-powered extraction
          </p>
          
          <div className="controls">
            <div className="file-input-wrapper">
              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/png,image/jpeg,image/jpg" 
                onChange={handleFileChange}
                className="file-input"
              />
              <button onClick={handleUploadClick} className="btn btn-upload">
                <Upload size={18} />
                {imageFile ? 'Change Document' : 'Upload Document'}
              </button>
            </div>
            
            <button 
              onClick={handleAnalyzeClick} 
              disabled={loading || !imageFile}
              className={`btn btn-analyze ${loading || !imageFile ? 'disabled' : ''}`}
            >
              {loading ? (
                <>
                  <Loader size={18} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <FileText size={18} />
                  Analyze Document
                </>
              )}
            </button>
          </div>
          
          {error && (
            <div className="alert error-state">
              <AlertCircle size={20} />
              {error}
            </div>
          )}
          
          {success && (
            <div className="alert success-state">
              <CheckCircle size={20} />
              {success}
            </div>
          )}
        </div>
      </header>
      
      <main className="App-main">
        <div className="panel image-section">
          <h2 className="section-title">
            <Eye size={20} />
            Document Preview
          </h2>
          <div className="image-container">
            {imageUrl ? (
              <>
                <img 
                  ref={imageRef} 
                  src={imageUrl} 
                  alt="Document Preview" 
                  className="preview-image"
                />
                {renderBoundingBoxes()}
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon"><Upload size={40} /></div>
                Upload a document to see the preview here
              </div>
            )}
          </div>
        </div>
        
        <div className="panel results-section">
          <h2 className="section-title">
            <FileText size={20} />
            Extracted Data
          </h2>
          
          {loading ? (
            <div className="loading-overlay">
              <Loader size={40} className="animate-spin" />
            </div>
          ) : textractData ? (
            <>
              {renderFormData()}
              {renderTableData()}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon"><FileText size={40} /></div>
              No data extracted yet. Analyze a document to see results.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;