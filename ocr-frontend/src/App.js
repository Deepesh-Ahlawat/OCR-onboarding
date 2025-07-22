// src/App.js

import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Eye, AlertCircle, CheckCircle, Loader, ZoomIn, ZoomOut, RotateCcw, Table } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import './App.css';

function App() {
  // --- STATE AND REFS ---
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [textractData, setTextractData] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [visualize, setVisualize] = useState(false);

  const imageRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  // --- PARSING LOGIC ---
  const parseAndRenderTables = (jsonData) => {
    if (!jsonData || !jsonData.Blocks) {
      setTables([]);
      return;
    }
    try {
      const { Blocks } = jsonData;
      const blockMap = new Map(Blocks.map(b => [b.Id, b]));
      const tableBlocks = Blocks.filter(b => b.BlockType === 'TABLE');
      const getTextFromBlock = (block) => {
        let text = '';
        if (block?.Relationships) {
          for (const rel of block.Relationships) {
            if (rel.Type === 'CHILD') {
              for (const childId of rel.Ids) {
                const word = blockMap.get(childId);
                if (word?.BlockType === 'WORD') {
                  text += word.Text + ' ';
                }
              }
            }
          }
        }
        return text.trim();
      };
      const parsedTables = tableBlocks.map(tableBlock => {
        const cellRelationships = tableBlock.Relationships?.find(r => r.Type === 'CHILD')?.Ids || [];
        const cellBlocks = cellRelationships.map(id => blockMap.get(id)).filter(b => b && b.BlockType === 'CELL');
        if (cellBlocks.length === 0) return null;
        const maxRow = Math.max(...cellBlocks.map(c => c.RowIndex + (c.RowSpan || 1) - 1));
        const maxCol = Math.max(...cellBlocks.map(c => c.ColumnIndex + (c.ColumnSpan || 1) - 1));
        const tableGrid = Array(maxRow).fill(null).map(() => Array(maxCol).fill(null));
        cellBlocks.forEach(cell => {
          const rowIndex = cell.RowIndex - 1;
          const colIndex = cell.ColumnIndex - 1;
          const cellData = {
            id: cell.Id,
            text: getTextFromBlock(cell),
            rowSpan: cell.RowSpan || 1,
            colSpan: cell.ColumnSpan || 1,
            confidence: cell.Confidence,
            cellType: cell.RowIndex === 1 ? 'COLUMN_HEADER' : 'DATA',
          };
          for (let r = rowIndex; r < rowIndex + cellData.rowSpan; r++) {
            for (let c = colIndex; c < colIndex + cellData.colSpan; c++) {
              if (r === rowIndex && c === colIndex) {
                tableGrid[r][c] = cellData;
              } else {
                tableGrid[r][c] = { spanned: true };
              }
            }
          }
        });
        return { id: tableBlock.Id, grid: tableGrid, rowCount: maxRow, colCount: maxCol };
      }).filter(Boolean);
      setTables(parsedTables);
    } catch (err) {
      console.error("Failed to parse Textract JSON for tables:", err);
      setError("Failed to parse table data from the response.");
      setTables([]);
    }
  };

  // --- HANDLERS ---
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setImageFile(file);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(URL.createObjectURL(file));
      setTextractData(null);
      setTables([]);
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
    setTables([]);
    setSelectedBlockId(null);
    const formData = new FormData();
    formData.append('file', imageFile);
    try {
      const response = await fetch('http://127.0.0.1:5001/api/analyze', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.type || 'Error'}: ${data.error || 'Unknown error'}`);
      setTextractData(data);
      parseAndRenderTables(data);
      setSuccess('Document analyzed successfully!');
    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
      setTextractData(null);
      setTables([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBlockClick = (blockId) => {
    setSelectedBlockId(prevId => prevId === blockId ? null : blockId);
  };

  // --- RENDERING LOGIC ---

  const renderBoundingBoxes = () => {
    if (!textractData?.Blocks || !imageRef.current) return null;
    // Simplified to only draw boxes for tables and cells
    const blocksToDraw = textractData.Blocks.filter(b => 
      b.Geometry && (b.BlockType === 'CELL' || b.BlockType === 'TABLE')
    );
    return blocksToDraw.map((block) => {
      const { BoundingBox } = block.Geometry;
      const isSelected = selectedBlockId === block.Id;
      const boxStyle = { top: `${BoundingBox.Top*100}%`, left: `${BoundingBox.Left*100}%`, width: `${BoundingBox.Width*100}%`, height: `${BoundingBox.Height*100}%` };
      return <div key={block.Id} className={`bounding-box ${isSelected ? 'selected' : ''}`} style={boxStyle} onClick={() => handleBlockClick(block.Id)} />;
    });
  };
  
  const renderAllTables = () => {
    if (tables.length === 0) return null;

    return (
      <div className="data-section">
        <div className="table-header-controls">
            <h3 className="section-title"><Table size={20} /> Extracted Table Data ({tables.length})</h3>
            <div className="toggle-control">
                <input
                    type="checkbox"
                    id="visualize-toggle"
                    checked={visualize}
                    onChange={(e) => setVisualize(e.target.checked)}
                />
                <label htmlFor="visualize-toggle">Color-coded View</label>
            </div>
        </div>
        {tables.map(table => (
          <div key={table.id} className="table-container">
            <table className="results-table">
              <tbody>
                {table.grid.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => {
                      if (cell?.spanned) return null;
                      if (!cell) return <td key={colIndex} className="cell-empty"></td>;

                      const isSelected = selectedBlockId === cell.id;
                      const cellClasses = ['cell'];
                      if (isSelected) cellClasses.push('selected-row');

                      if (visualize) {
                          cellClasses.push(`cell-type-${cell.cellType.toLowerCase()}`);
                      } else {
                          if(cell.cellType === 'COLUMN_HEADER') cellClasses.push('cell-header-default');
                      }

                      return (
                        <td
                          key={cell.id}
                          className={cellClasses.join(' ')}
                          colSpan={cell.colSpan}
                          rowSpan={cell.rowSpan}
                          onClick={() => handleBlockClick(cell.id)}
                        >
                          <div className="cell-content">
                            {cell.text || '\u00A0'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  };
  
  // --- MAIN COMPONENT JSX ---
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
           {/* The title here is now static as it only shows table data */}
           <h2 className="section-title"><Table size={20} /> Extracted Data</h2>
           <div className="results-content">
            {loading ? (<div className="loading-overlay"><Loader size={40} className="animate-spin" /></div>) : 
            textractData ? (<div className="animate-fade-in">{renderAllTables()}</div>) : 
            (<div className="empty-state"><Eye size={40} className="empty-state-icon"/> <p>Table results will appear here after analysis.</p></div>)}
           </div>
        </div>
      </main>
    </div>
  );
}

export default App;