// src/App.js

import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Eye, AlertCircle, CheckCircle, Loader, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import './App.css';

function App() {
  // --- STATE AND REFS (No changes here) ---
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [textractData, setTextractData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [success, setSuccess] = useState('');
  
  const imageRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  // --- HANDLERS (No changes here) ---
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setImageFile(file);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(URL.createObjectURL(file));
      setTextractData(null);
      setError('');
      setSuccess('');
      setSelectedBlockId(null);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

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
      const response = await fetch('http://127.0.0.1:5001/api/analyze', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.type || 'Error'}: ${data.error || 'Unknown error'}`);
      setTextractData(data);
      setSuccess('Document analyzed successfully!');
    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
      setTextractData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleBlockClick = (blockId) => setSelectedBlockId(blockId);

  // --- HELPER FUNCTION to get text from WORD blocks ---
  const getTextFromBlock = (block, allBlocks) => {
    let text = '';
    if (block?.Relationships) {
      block.Relationships.forEach(rel => {
        if (rel.Type === 'CHILD') {
          rel.Ids.forEach(childId => {
            const word = allBlocks.find(b => b.Id === childId);
            if (word?.BlockType === 'WORD') text += word.Text + ' ';
          });
        }
      });
    }
    return text.trim();
  };

  // --- RENDERING LOGIC (The Important Updates are Here) ---

  const renderBoundingBoxes = () => {
    if (!textractData?.Blocks || !imageRef.current) return null;
    
    // We want to draw boxes for both Tables, Cells, and Key-Value sets
    const blocksToDraw = textractData.Blocks.filter(b => 
      b.Geometry && (b.BlockType === 'CELL' || b.BlockType === 'KEY_VALUE_SET' || b.BlockType === 'TABLE')
    );

    return blocksToDraw.map((block) => {
      const { BoundingBox } = block.Geometry;
      const isSelected = selectedBlockId === block.Id;
      const boxStyle = { top: `${BoundingBox.Top*100}%`, left: `${BoundingBox.Left*100}%`, width: `${BoundingBox.Width*100}%`, height: `${BoundingBox.Height*100}%` };
      return <div key={block.Id} className={`bounding-box ${isSelected ? 'selected' : ''}`} style={boxStyle} onClick={() => handleBlockClick(block.Id)} />;
    });
  };

  // --- NEW: Correct implementation for Key-Value Pairs ---
  const renderFormData = () => {
    if (!textractData?.Blocks) return null;
    const allBlocks = textractData.Blocks;

    // 1. Find all KEY blocks
    const keyBlocks = allBlocks.filter(b => b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes.includes('KEY'));
    
    if (keyBlocks.length === 0) return null;

    return (
      <div className="data-section">
        <h3 className="section-title"><FileText size={20} /> Extracted Form Data</h3>
        <table className="results-table">
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>
            {keyBlocks.map(keyBlock => {
              // 2. For each KEY, find its associated VALUE block via relationships
              const valueBlock = keyBlock.Relationships?.find(r => r.Type === 'VALUE')?.Ids.map(id => allBlocks.find(b => b.Id === id))[0];
              
              // 3. Extract text from both KEY and VALUE blocks
              const keyText = getTextFromBlock(keyBlock, allBlocks);
              const valueText = valueBlock ? getTextFromBlock(valueBlock, allBlocks) : '';

              const isSelected = selectedBlockId === keyBlock.Id || (valueBlock && selectedBlockId === valueBlock.Id);

              return (
                <tr key={keyBlock.Id} className={isSelected ? 'selected-row' : ''} onClick={() => handleBlockClick(keyBlock.Id)}>
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
  
// --- In App.js, REPLACE your entire renderTableData function with this one ---

  const renderTableData = () => {
    if (!textractData?.Blocks) return null;
    const allBlocks = textractData.Blocks;

    // 1. Find all TABLE blocks
    const tableBlocks = allBlocks.filter(b => b.BlockType === 'TABLE');
    if (tableBlocks.length === 0) return null;

    // --- START OF THE FIX ---
    // 2. Identify the "main" table. We'll assume it's the one with the most cells.
    // This prevents rendering smaller, form-like tables that might also be detected.
    const mainTable = tableBlocks.reduce((largest, current) => {
        const largestCellCount = largest.Relationships?.find(r => r.Type === 'CHILD')?.Ids.length || 0;
        const currentCellCount = current.Relationships?.find(r => r.Type === 'CHILD')?.Ids.length || 0;
        return currentCellCount > largestCellCount ? current : largest;
    }, tableBlocks[0]); // Start with the first table as the initial largest
    // --- END OF THE FIX ---

    // 3. Find all CELL blocks that are children of ONLY the main table
    const cellIds = mainTable.Relationships?.find(r => r.Type === 'CHILD')?.Ids || [];
    const cellBlocks = cellIds.map(id => allBlocks.find(b => b.Id === id)).filter(Boolean);
    if (cellBlocks.length === 0) return null;

    // 4. Group cells by RowIndex
    const rows = cellBlocks.reduce((acc, cell) => {
      const rowIndex = cell.RowIndex;
      (acc[rowIndex] = acc[rowIndex] || []).push(cell);
      return acc;
    }, {});

    // 5. Render the table structure
    return (
      <div className="data-section">
        <h3 className="section-title"><Eye size={20} /> Extracted Table Data</h3>
        <table key={mainTable.Id} className="results-table">
          <tbody>
            {Object.keys(rows)
              .sort((a, b) => Number(a) - Number(b)) // Sort rows numerically
              .map(rowIndex => (
                <tr key={rowIndex}>
                  {rows[rowIndex]
                    .sort((a, b) => a.ColumnIndex - b.ColumnIndex) // Sort cells by column
                    .map(cell => {
                      const cellText = getTextFromBlock(cell, allBlocks);
                      const isSelected = selectedBlockId === cell.Id;
                      return (
                        <td
                          key={cell.Id}
                          className={isSelected ? 'selected-row' : ''}
                          onClick={() => handleBlockClick(cell.Id)}
                          colSpan={cell.ColumnSpan || 1}
                          rowSpan={cell.RowSpan || 1}
                        >
                          <input type="text" defaultValue={cellText} className="table-input" />
                        </td>
                      );
                    })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  };
  
  // --- MAIN COMPONENT JSX (No changes here) ---
  return (
    <div className="App">
      <header className="App-header">
         <div className="header-content">
          <h1 className="header-title">Document Intelligence Platform</h1>
          <div className="controls">
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,application/pdf" onChange={handleFileChange} style={{ display: 'none' }} />
            <button onClick={handleUploadClick} className="btn btn-upload"><Upload size={18} /> {imageFile ? 'Change Document' : 'Upload Document'}</button>
            <button onClick={handleAnalyzeClick} disabled={loading || !imageFile} className={`btn btn-analyze ${loading || !imageFile ? 'disabled' : ''}`}>
              {loading ? (<><Loader size={18} className="animate-spin" /> Analyzing...</>) : (<><FileText size={18} /> Analyze</>)}
            </button>
          </div>
          {error && (<div className="alert error-state animate-fade-in"><AlertCircle size={20} /> {error}</div>)}
          {success && (<div className="alert success-state animate-fade-in"><CheckCircle size={20} /> {success}</div>)}
        </div>
      </header>
      
      <main className="App-main">
        <div className="panel image-section">
           <h2 className="section-title"><Eye size={20} /> Document Preview</h2>
          <div className="image-preview-wrapper">
            {imageUrl ? (
              <TransformWrapper options={{ limitToBounds: false }} pan={{ velocity: true }} wheel={{ step: 0.2 }} doubleClick={{ disabled: true }} zoomAnimation={{ animationTime: 200, animationType: 'easeOut' }}>
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    <div className="zoom-controls">
                      <button onClick={() => zoomIn(0.2)}><ZoomIn size={18} /></button>
                      <button onClick={() => zoomOut(0.2)}><ZoomOut size={18} /></button>
                      <button onClick={() => resetTransform()}><RotateCcw size={18} /></button>
                    </div>
                    <TransformComponent wrapperClass="transform-wrapper" contentClass="image-box-container">
                        <img ref={imageRef} src={imageUrl} alt="Preview" className="preview-image"/>
                        {renderBoundingBoxes()}
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            ) : (
              <div className="empty-state"><FileText size={40} className="empty-state-icon" /> <p>Upload a document to begin.</p></div>
            )}
          </div>
        </div>
        <div className="panel results-section">
           <h2 className="section-title"><FileText size={20} /> Extracted Data</h2>
          {loading ? (<div className="loading-overlay"><Loader size={40} className="animate-spin" /></div>) : 
           textractData ? (<div className="animate-fade-in">{renderFormData()}{renderTableData()}</div>) : 
           (<div className="empty-state"><Eye size={40} className="empty-state-icon"/> <p>Results will appear here after analysis.</p></div>)}
        </div>
      </main>
    </div>
  );
}

export default App;