// src/App.js

import React, { useState, useRef, useEffect } from 'react';
// --- Import the new X icon ---
import { Upload, FileText, Eye, AlertCircle, CheckCircle, Loader, ZoomIn, ZoomOut, RotateCcw, Table, Save, Tag, X } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import './App.css';

// --- HELPER FUNCTION (No Change) ---
const getText = (block, fullMap) => {
    if (!block) return '';
    const childRel = block.Relationships?.find(r => r.Type === 'CHILD');
    if (!childRel) return '';
    const childBlocks = childRel.Ids.map(id => fullMap.get(id)).filter(Boolean);
    const lineBlocks = childBlocks.filter(b => b.BlockType === 'LINE');
    if (!lineBlocks.length) {
        const wordBlocks = childBlocks.filter(b => b.BlockType === 'WORD');
        if (wordBlocks.length > 0) {
            wordBlocks.sort((a,b) => a.Geometry.BoundingBox.Left - b.Geometry.BoundingBox.Left);
            return wordBlocks.map(w => w.Text).join(' ');
        }
        return '';
    }
    lineBlocks.sort((a, b) => a.Geometry.BoundingBox.Top - b.Geometry.BoundingBox.Top);
    return lineBlocks.map(line => line.Text).join(' ');
};

function App() {
  // --- STATE AND REFS (No changes) ---
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [textractData, setTextractData] = useState(null);
  const [blocksMap, setBlocksMap] = useState(new Map());
  const [cellMergedMap, setCellMergedMap] = useState(new Map());
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [visualize, setVisualize] = useState(false);
  const [sensorTags, setSensorTags] = useState(new Map());
  const [activeTaggingCell, setActiveTaggingCell] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);

  const imageRef = useRef(null);
  const fileInputRef = useRef(null);
  const transformComponentRef = useRef(null);

  // Cleanup URL
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  // --- PARSE & BUILD TABLES (No changes) ---
  const parseAndRenderTables = (jsonData) => {
    const Blocks = jsonData?.Blocks || [];
    if (!Blocks.length) { setTables([]); return; }
    const fullMap = new Map(Blocks.map(b => [b.Id, b]));
    setBlocksMap(fullMap);
    const mergedBlocks = Blocks.filter(b => b.BlockType === 'MERGED_CELL');
    const localCellMerged = new Map();
    mergedBlocks.forEach(mb => {
      const rel = mb.Relationships?.find(r => r.Type === 'CHILD');
      rel?.Ids.forEach(id => localCellMerged.set(id, mb.Id));
    });
    setCellMergedMap(localCellMerged);
    const tablesRaw = Blocks.filter(b => b.BlockType === 'TABLE');
    const parsed = tablesRaw.map(table => {
      const childRel = table.Relationships?.find(r => r.Type === 'CHILD');
      const cellIds = childRel?.Ids || [];
      if (!cellIds.length) return null;
      const synthetic = mergedBlocks
        .filter(mb => mb.Relationships?.find(r => r.Type === 'CHILD')?.Ids.some(id => cellIds.includes(id)))
        .map(mb => {
          const childRel = mb.Relationships?.find(r => r.Type === 'CHILD');
          const childIds = childRel?.Ids || [];
          const mergedText = childIds
            .map(cid => {
              const childBlock = fullMap.get(cid);
              return childBlock ? getText(childBlock, fullMap) : '';
            })
            .filter(t => t.trim().length > 0)
            .join(' ');
          return { id: mb.Id, RowIndex: mb.RowIndex, ColumnIndex: mb.ColumnIndex, rowSpan: mb.RowSpan || 1, colSpan: mb.ColumnSpan || 1, text: mergedText || ' ' };
        });
      const mergedChildIds = new Set(mergedBlocks.flatMap(mb => mb.Relationships.find(r => r.Type === 'CHILD').Ids));
      const raw = cellIds
        .map(id => fullMap.get(id))
        .filter(cb => cb && cb.BlockType === 'CELL' && !mergedChildIds.has(cb.Id))
        .map(cb => ({ id: cb.Id, RowIndex: cb.RowIndex, ColumnIndex: cb.ColumnIndex, rowSpan: cb.RowSpan || 1, colSpan: cb.ColumnSpan || 1, text: getText(cb, fullMap) || ' ' }));
      const allCells = [...synthetic, ...raw];
      if (allCells.length === 0) return null;
      const maxRow = Math.max(...allCells.map(c => c.RowIndex + c.rowSpan - 1));
      const maxCol = Math.max(...allCells.map(c => c.ColumnIndex + c.colSpan - 1));
      const grid = Array.from({ length: maxRow }, () => Array(maxCol).fill(null));
      allCells.forEach(cell => {
        const r = cell.RowIndex - 1;
        const c = cell.ColumnIndex - 1;
        if(grid[r]) {
          grid[r][c] = { id: cell.id, rowSpan: cell.rowSpan, colSpan: cell.colSpan, text: cell.text, isHeader: (cell.RowIndex === 1 || cell.ColumnIndex === 1) };
          for (let dr = 0; dr < cell.rowSpan; dr++) {
            for (let dc = 0; dc < cell.colSpan; dc++) {
              if (dr !== 0 || dc !== 0) {
                if (grid[r + dr]) {
                    grid[r + dr][c + dc] = { spanned: true };
                }
              }
            }
          }
        }
      });
      return { id: table.Id, grid };
    }).filter(Boolean);
    setTables(parsed);
  }
  
  // --- EVENT HANDLERS ---
  const handleBlockClick = (blockId) => {
    const root = cellMergedMap.get(blockId) || blockId;
    setSelectedBlockId(prev => prev === root ? null : root);
    setTimeout(() => {
      const targetElement = document.getElementById(`cell-${root}`);
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 50);
    if (transformComponentRef.current) {
        const { zoomToElement } = transformComponentRef.current;
        const boundingBoxId = `bbox-${root}`;
        zoomToElement(boundingBoxId, 1.5, 200, 'easeOut');
    }
  };

  const resetState = () => { setTextractData(null); setTables([]); setError(''); setSuccess(''); setSelectedBlockId(null); setSensorTags(new Map()); setShowCoverage(false); }
  const onFileChange = e => { const f = e.target.files[0]; if (!f) return; setImageFile(f); if (imageUrl) URL.revokeObjectURL(imageUrl); setImageUrl(URL.createObjectURL(f)); resetState(); };
  const onUpload = () => fileInputRef.current?.click();
  const onAnalyze = async () => {
    if (!imageFile) { setError('Select a document first.'); return; }
    setLoading(true);
    resetState();
    try {
      const fd = new FormData(); fd.append('file', imageFile);
      const resp = await fetch('http://127.0.0.1:5001/api/analyze',{method:'POST',body:fd});
      const data = await resp.json(); if (!resp.ok) throw new Error(data.error || 'Analysis failed');
      setTextractData(data); 
      parseAndRenderTables(data); 
      setSuccess('Analysis successful');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  
  const handleTagChange = (cellId, newTag) => {
    const newTags = new Map(sensorTags);
    newTags.set(cellId, newTag);
    setSensorTags(newTags);
  };
  
  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      setActiveTaggingCell(null);
    }
  };

  // --- NEW Delete Tag Handler ---
  const handleDeleteTag = (cellId) => {
    const newTags = new Map(sensorTags);
    newTags.delete(cellId);
    setSensorTags(newTags);
  };
  
  const handleSaveTags = async () => {
    setIsSaving(true);
    setSuccess('');
    setError('');
    const payload = Array.from(sensorTags.entries())
      .filter(([, tag]) => tag.trim() !== "")
      .map(([blockId, sensorTag]) => {
        let cellText = '';
        for (const table of tables) {
          for (const row of table.grid) {
            const foundCell = row.find(cell => cell && cell.id === blockId);
            if (foundCell) {
              cellText = foundCell.text;
              break;
            }
          }
          if (cellText) break;
        }
        return { blockId: blockId, cellText: cellText.trim(), sensorTag: sensorTag };
      });
    console.log("--- Sending to Backend ---");
    console.log(JSON.stringify(payload, null, 2));
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false);
    setSuccess(`${payload.length} tags saved successfully!`);
  };

  // --- RENDER LOGIC ---
  const renderBoundingBoxes = () => {
    if (!textractData?.Blocks || !imageRef.current) return null;
    const uniqueRootBlocks = new Map();
    textractData.Blocks
      .filter(b => b.BlockType === 'CELL' || b.BlockType === 'MERGED_CELL')
      .forEach(cell => {
        const rootId = cellMergedMap.get(cell.Id) || cell.Id;
        if (!uniqueRootBlocks.has(rootId)) {
          uniqueRootBlocks.set(rootId, {
            originalCellId: cell.Id, 
            rootBlock: blocksMap.get(rootId) || cell
          });
        }
      });
    
    return Array.from(uniqueRootBlocks.values()).map(({ originalCellId, rootBlock }) => {
      const { BoundingBox } = rootBlock.Geometry;
      const isSel = selectedBlockId === rootBlock.Id;
      const hasTag = sensorTags.has(rootBlock.Id) && sensorTags.get(rootBlock.Id).trim() !== '';
      const boxClasses = `bounding-box ${isSel ? 'selected' : ''} ${showCoverage ? 'coverage-visible' : ''} ${hasTag ? 'tagged' : ''}`;
      const style = { top: `${BoundingBox.Top*100}%`, left: `${BoundingBox.Left*100}%`, width: `${BoundingBox.Width*100}%`, height: `${BoundingBox.Height*100}%`};
      return (
        <div id={`bbox-${rootBlock.Id}`} key={rootBlock.Id} className={boxClasses} style={style} onClick={() => handleBlockClick(originalCellId)} />
      );
    });
  };
  
  const renderAllTables = () => {
    if (!tables.length) return null;
    return (
      <div className="data-section">
        <div className="table-header-controls">
          <h3 className="section-title"><Table size={20} /> Extracted Tables ({tables.length})</h3>
          <div className="controls-right">
            <label className="toggle-control"><input type="checkbox" checked={visualize} onChange={e => setVisualize(e.target.checked)} /> Color-coded</label>
            <button className="btn btn-save" onClick={handleSaveTags} disabled={isSaving || sensorTags.size === 0}>
              {isSaving ? <><Loader className="animate-spin" size={18}/> Saving...</> : <><Save size={18}/> Save All Tags</>}
            </button>
          </div>
        </div>
        {tables.map(table => (
          <div key={table.id} className="table-container">
            <table className="results-table"><tbody>
              {table.grid.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell) => {
                    if (!cell || cell.spanned) return null;
                    const root = cellMergedMap.get(cell.id) || cell.id;
                    const isSel = selectedBlockId === root;
                    const isTaggable = !cell.isHeader && cell.text.trim() !== ' ';
                    return (
                      <td 
                        id={`cell-${cell.id}`} 
                        key={cell.id} 
                        rowSpan={cell.rowSpan} 
                        colSpan={cell.colSpan} 
                        className={['cell', isSel ? 'selected-row' : '', isTaggable ? 'taggable-cell' : ''].join(' ')} 
                        onClick={() => {
                            handleBlockClick(cell.id);
                            if(isTaggable) setActiveTaggingCell(cell.id);
                        }}
                      >
                        {activeTaggingCell === cell.id ? (
                            <div className="cell-content-editing">
                                <Tag size={16} className="tag-icon"/>
                                <input
                                    type="text"
                                    className="tag-input"
                                    placeholder="Enter sensor tag..."
                                    value={sensorTags.get(cell.id) || ''}
                                    onChange={(e) => handleTagChange(cell.id, e.target.value)}
                                    onKeyDown={handleTagInputKeyDown}
                                    onBlur={() => setActiveTaggingCell(null)}
                                    autoFocus
                                />
                            </div>
                        ) : (
                            <div className="cell-content">
                                <span className="cell-text">{cell.text}</span>
                                {sensorTags.has(cell.id) && sensorTags.get(cell.id) &&
                                    <span className="sensor-tag-badge">
                                        <Tag size={12} /> 
                                        {sensorTags.get(cell.id)}
                                        {/* --- NEW Delete Button --- */}
                                        <button 
                                          className="delete-tag-btn"
                                          onClick={(e) => {
                                            e.stopPropagation(); // Prevent cell click
                                            handleDeleteTag(cell.id);
                                          }}
                                        >
                                          <X size={12}/>
                                        </button>
                                    </span>
                                }
                            </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
      </div>
    );
  };

  // --- MAIN JSX ---
  return (
    <div className="App">
      <header className="App-header">
        <div className="header-main">
            <h1>Document Intelligence Platform</h1>
            <div className="controls">
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={onFileChange} style={{ display:'none' }}/>
                <button className="btn btn-upload" onClick={onUpload}><Upload size={18}/> {imageFile?'Change Document':'Upload Document'}</button>
                <button className={`btn btn-analyze ${(!imageFile||loading)?'disabled':''}`} onClick={onAnalyze} disabled={!imageFile||loading}>
                    {loading?<><Loader className="animate-spin" size={18}/> Analyzing...</>:<><FileText size={18}/> Analyze</>}
                </button>
            </div>
        </div>
        <div className="header-alerts">
            {error && <div className="alert error-state"><AlertCircle size={20}/> {error}</div>}
            {success && <div className="alert success-state"><CheckCircle size={20}/> {success}</div>}
        </div>
      </header>
      
      <main className="App-main">
        <section className="panel image-section">
          <div className="panel-header">
            <h2 className="section-title"><Eye size={20}/> Document Preview</h2>
            {imageUrl && (
              <div className="view-controls">
                <label className="toggle-control">
                  <input 
                    type="checkbox" 
                    checked={showCoverage} 
                    onChange={e => setShowCoverage(e.target.checked)} 
                  /> 
                  Show Coverage
                </label>
              </div>
            )}
          </div>
          <div className="image-preview-wrapper">
            {imageUrl?
              <TransformWrapper ref={transformComponentRef} options={{limitToBounds:false}} pan={{velocity:true}} wheel={{step:0.2}} doubleClick={{disabled:true}} zoomAnimation={{animationTime:200}}>
                {({zoomIn,zoomOut,resetTransform})=><>
                  <div className="zoom-controls"><button onClick={()=>zoomIn(0.2)}><ZoomIn size={18}/></button><button onClick={()=>zoomOut(0.2)}><ZoomOut size={18}/></button><button onClick={()=>resetTransform()}><RotateCcw size={18}/></button></div>
                  <TransformComponent wrapperClass="transform-wrapper"><img ref={imageRef} src={imageUrl} alt="Preview" className="preview-image"/>{renderBoundingBoxes()}</TransformComponent>
                </>}
              </TransformWrapper>
            :<div className="empty-state"><FileText size={40}/><p>Upload a document to begin.</p></div>}
          </div>
        </section>
        <section className="panel results-section">
          <h2 className="section-title"><Table size={20}/> Extracted Data</h2>
          <div className="results-content">
            {loading?<div className="loading-overlay"><Loader size={40} className="animate-spin"/></div>
            : textractData? renderAllTables() : <div className="empty-state"><Eye size={40}/><p>Extracted tables will appear here.</p></div>}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;