import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Eye, AlertCircle, CheckCircle, Loader, ZoomIn, ZoomOut, RotateCcw, Table } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import './App.css';

function App() {
  // --- STATE AND REFS ---
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [textractData, setTextractData] = useState(null);
  const [blocksMap, setBlocksMap] = useState(new Map());
  const [mergedCellMap, setMergedCellMap] = useState(new Map());
  const [cellMergedMap, setCellMergedMap] = useState(new Map());
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

  // --- PARSE & BUILD TABLES & MERGED REGIONS ---
  const parseAndRenderTables = (jsonData) => {
    const Blocks = jsonData?.Blocks || [];
    if (!Blocks.length) {
      setTables([]);
      return;
    }

    // Build full map
    const fullMap = new Map(Blocks.map(b => [b.Id, b]));
    setBlocksMap(fullMap);

    // Detect MERGED_CELL blocks
    const mergedBlocks = Blocks.filter(b => b.BlockType === 'MERGED_CELL');
    const mergedMap = new Map(mergedBlocks.map(m => [m.Id, m]));
    const cellToMerge = new Map();
    mergedBlocks.forEach(mBlk => {
      const rel = mBlk.Relationships?.find(r => r.Type === 'CHILD');
      rel?.Ids.forEach(childId => cellToMerge.set(childId, mBlk.Id));
    });
    setMergedCellMap(mergedMap);
    setCellMergedMap(cellToMerge);

    // Find tables
    const tablesRaw = Blocks.filter(b => b.BlockType === 'TABLE');
    const parsed = tablesRaw.map(table => {
      const childRel = table.Relationships?.find(r => r.Type === 'CHILD');
      const cellIds = childRel?.Ids || [];
      const cellBlocks = cellIds.map(id => fullMap.get(id)).filter(b => b.BlockType === 'CELL');
      if (!cellBlocks.length) return null;

      // Determine grid size
      const maxRow = Math.max(...cellBlocks.map(c => c.RowIndex + (c.RowSpan || 1) - 1));
      const maxCol = Math.max(...cellBlocks.map(c => c.ColumnIndex + (c.ColumnSpan || 1) - 1));
      const grid = Array.from({ length: maxRow }, () => Array(maxCol).fill(null));

      const getText = (cell) => {
        const rel = cell.Relationships?.find(r => r.Type === 'CHILD');
        if (!rel) return '';
        const parts = rel.Ids.map(id => fullMap.get(id)).filter(Boolean);
        const lines = parts.filter(p => p.BlockType === 'LINE');
        if (lines.length) {
          lines.sort((a, b) =>
            a.Geometry.BoundingBox.Top - b.Geometry.BoundingBox.Top ||
            a.Geometry.BoundingBox.Left - b.Geometry.BoundingBox.Left
          );
          return lines.map(l => l.Text).join(' ');
        }
        const words = parts.filter(p => p.BlockType === 'WORD');
        words.sort((a, b) =>
          a.Geometry.BoundingBox.Top - b.Geometry.BoundingBox.Top ||
          a.Geometry.BoundingBox.Left - b.Geometry.BoundingBox.Left
        );
        return words.map(w => w.Text).join(' ');
      };

      // Populate grid with spans
      cellBlocks.forEach(cell => {
        const r = cell.RowIndex - 1;
        const c = cell.ColumnIndex - 1;
        const rs = cell.RowSpan || 1;
        const cs = cell.ColumnSpan || 1;
        const txt = getText(cell) || '\u00A0';
        grid[r][c] = { id: cell.Id, rowSpan: rs, colSpan: cs, text: txt };
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr !== 0 || dc !== 0) grid[r + dr][c + dc] = { spanned: true };
          }
        }
      });

      return { id: table.Id, grid };
    }).filter(Boolean);

    setTables(parsed);
  };

  // --- CLICK HANDLER (MERGED AWARE) ---
  const handleBlockClick = (blockId) => {
    const rootId = cellMergedMap.get(blockId) || blockId;
    setSelectedBlockId(prev => prev === rootId ? null : rootId);
  };

  // --- RENDER BOUNDARIES ---
  const renderBoundingBoxes = () => {
    if (!textractData?.Blocks || !imageRef.current) return null;
    return textractData.Blocks
      .filter(b => b.BlockType === 'CELL')
      .map(cell => {
        const rootId = cellMergedMap.get(cell.Id) || cell.Id;
        const root = blocksMap.get(rootId) || cell;
        const { BoundingBox } = root.Geometry;
        const isSel = selectedBlockId === rootId;
        const style = {
          top: `${BoundingBox.Top * 100}%`,
          left: `${BoundingBox.Left * 100}%`,
          width: `${BoundingBox.Width * 100}%`,
          height: `${BoundingBox.Height * 100}%`
        };
        return (
          <div
            key={rootId}
            className={`bounding-box ${isSel ? 'selected' : ''}`}
            style={style}
            onClick={() => handleBlockClick(cell.Id)}
          />
        );
      });
  };

  // --- RENDER TABLES ---
  const renderAllTables = () => {
    if (!tables.length) return null;
    return (
      <div className="data-section">
        <div className="table-header-controls">
          <h3 className="section-title"><Table size={20} /> Extracted Tables ({tables.length})</h3>
          <div className="toggle-control">
            <input type="checkbox" checked={visualize} onChange={e => setVisualize(e.target.checked)} />
            <label>Color-coded View</label>
          </div>
        </div>
        {tables.map(table => (
          <div key={table.id} className="table-container">
            <table className="results-table">
              <tbody>
                {table.grid.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => {
                      if (!cell || cell.spanned) return null;
                      const root = cellMergedMap.get(cell.id) || cell.id;
                      const isSel = selectedBlockId === root;
                      return (
                        <td
                          key={cell.id}
                          rowSpan={cell.rowSpan}
                          colSpan={cell.colSpan}
                          className={[ 'cell', isSel ? 'selected-row' : '', visualize ? 'highlight-cell' : '' ].join(' ')}
                          onClick={() => handleBlockClick(cell.id)}
                        >
                          <div className="cell-content">{cell.text}</div>
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

  // --- FILE & ANALYSIS HANDLERS ---
  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setImageFile(f);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(f));
    setTextractData(null);
    setTables([]);
    setError('');
    setSuccess('');
    setSelectedBlockId(null);
  };
  const handleUploadClick = () => fileInputRef.current?.click();
  const handleAnalyzeClick = async () => {
    if (!imageFile) { setError('Please select an image first.'); return; }
    setLoading(true);
    setError('');
    setSuccess('');
    setTables([]);
    setSelectedBlockId(null);
    try {
      const formData = new FormData();
      formData.append('file', imageFile);
      const resp = await fetch('http://127.0.0.1:5001/api/analyze', { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Analysis failed');
      setTextractData(data);
      parseAndRenderTables(data);
      setSuccess('Analysis complete!');
    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // --- MAIN JSX ---
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
          {error && <div className="alert error-state"><AlertCircle size={20} /> {error}</div>}
          {success && <div className="alert success-state"><CheckCircle size={20} /> {success}</div>}
        </div>
      </header>

      <main className="App-main">
        <div className="panel image-section">
          <h2 className="section-title"><Eye size={20} /> Document Preview</h2>
          <div className="image-preview-wrapper">
            {imageUrl ? (
              <TransformWrapper options={{ limitToBounds: false }} pan={{ velocity: true }} wheel={{ step: 0.2 }} doubleClick={{ disabled: true }} zoomAnimation={{ animationTime: 200 }}>
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>  
                    <div className="zoom-controls">
                      <button onClick={() => zoomIn(0.2)}><ZoomIn size={18} /></button>
                      <button onClick={() => zoomOut(0.2)}><ZoomOut size={18} /></button>
                      <button onClick={() => resetTransform()}><RotateCcw size={18} /></button>
                    </div>
                    <TransformComponent wrapperClass="transform-wrapper" contentClass="image-box-container">
                      <img ref={imageRef} src={imageUrl} alt="Preview" className="preview-image" />
                      {renderBoundingBoxes()}
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            ) : (
              <div className="empty-state"><FileText size={40} /> <p>Upload a document to begin.</p></div>
            )}
          </div>
        </div>

        <div className="panel results-section">
          <h2 className="section-title"><Table size={20} /> Extracted Data</h2>
          <div className="results-content">
            {loading
              ? <div className="loading-overlay"><Loader size={40} className="animate-spin" /></div>
              : textractData
                ? renderAllTables()
                : <div className="empty-state"><Eye size={40} /> <p>Table results will appear here after analysis.</p></div>
            }
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
