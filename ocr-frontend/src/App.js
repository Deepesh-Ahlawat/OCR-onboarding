import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, FileText, Eye, AlertCircle, CheckCircle, Loader, ZoomIn, ZoomOut, RotateCcw, Table, Save, Tag, X, PlusCircle, Scissors, Check, RefreshCw } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import './App.css';
import { getCroppedImg } from './cropImage';
import AnnotationCanvas from './AnnotationCanvas';

// --- HELPER FUNCTION ---
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

// --- MODAL COMPONENT ---
function AddCellModal({ onSave, onCancel }) {
    const handleSubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const newCell = {
            id: `custom-${Date.now()}`,
            label: formData.get('label'),
            valueType: formData.get('valueType'),
            sensorTag: formData.get('sensorTag')
        };
        onSave(newCell);
    };
    return (
        <div className="modal-backdrop" onClick={onCancel}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h3>Add Custom Field</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-group"><label htmlFor="label">Label / Context</label><input id="label" name="label" type="text" placeholder="e.g., Sludge Meter, PH" required /></div>
                    <div className="form-group"><label>Datatype</label><div className="radio-group"><label><input type="radio" name="valueType" value="string" defaultChecked /><span className="radio-label-text">Text (string)</span></label><label><input type="radio" name="valueType" value="int" /><span className="radio-label-text">Number (int)</span></label></div></div>
                    <div className="form-group"><label htmlFor="sensorTag">Sensor Tag</label><input id="sensorTag" name="sensorTag" type="text" placeholder="e.g., stp_sludge_meter_reading" required /></div>
                    <div className="form-actions"><button type="button" className="btn btn-cancel" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-save">Save Field</button></div>
                </form>
            </div>
        </div>
    );
}

function App() {
  // --- STATE AND REFS ---
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
  const [sensorTags, setSensorTags] = useState(new Map());
  const [activeTaggingCell, setActiveTaggingCell] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [customCells, setCustomCells] = useState([]);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [cropPixels, setCropPixels] = useState(null);
  const [croppedImage, setCroppedImage] = useState(null);
  const [annotatedSections, setAnnotatedSections] = useState([]);
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);
  const [annotationKey, setAnnotationKey] = useState(Date.now());

  const imageRef = useRef(null);
  const fileInputRef = useRef(null);
  const transformComponentRef = useRef(null);

  // This useEffect correctly manages the lifecycle of the main imageUrl.
  // It runs when `imageUrl` changes or on unmount, cleaning up the *previous* URL.
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  // This useEffect serves as a final safety net to clean up any remaining
  // annotated image URLs when the entire application is unmounted.
  useEffect(() => {
    return () => {
        annotatedSections.forEach(section => {
            if(section.croppedImage) URL.revokeObjectURL(section.croppedImage)
        });
    }
  }, [annotatedSections]);


  // --- PARSE & BUILD TABLES ---
  const parseAndBuildTables = (jsonData, isAnnotation = false) => {
    const Blocks = jsonData?.Blocks || [];
    if (!Blocks.length) {
        if (isAnnotation) return [];
        setTables([]);
        return;
    }

    const fullMap = isAnnotation ? new Map([...blocksMap, ...Blocks.map(b => [b.Id, b])]) : new Map(Blocks.map(b => [b.Id, b]));
    if(!isAnnotation) setBlocksMap(fullMap);
    
    const mergedBlocks = Blocks.filter(b => b.BlockType === 'MERGED_CELL');
    if(!isAnnotation) {
        const localCellMerged = new Map();
        mergedBlocks.forEach(mb => {
            const rel = mb.Relationships?.find(r => r.Type === 'CHILD');
            rel?.Ids.forEach(id => localCellMerged.set(id, mb.Id));
        });
        setCellMergedMap(localCellMerged);
    }

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
          const mergedText = childIds.map(cid => { const childBlock = fullMap.get(cid); return childBlock ? getText(childBlock, fullMap) : ''; }).filter(t => t.trim().length > 0).join(' ');
          return { id: mb.Id, RowIndex: mb.RowIndex, ColumnIndex: mb.ColumnIndex, rowSpan: mb.RowSpan || 1, colSpan: mb.ColumnSpan || 1, text: mergedText || ' ' };
        });
      const mergedChildIds = new Set(mergedBlocks.flatMap(mb => mb.Relationships.find(r => r.Type === 'CHILD').Ids));
      const raw = cellIds.map(id => fullMap.get(id)).filter(cb => cb && cb.BlockType === 'CELL' && !mergedChildIds.has(cb.Id)).map(cb => ({ id: cb.Id, RowIndex: cb.RowIndex, ColumnIndex: cb.ColumnIndex, rowSpan: cb.RowSpan || 1, colSpan: cb.ColumnSpan || 1, text: getText(cb, fullMap) || ' ' }));
      const allCells = [...synthetic, ...raw];
      if (allCells.length === 0) return null;
      const maxRow = Math.max(0, ...allCells.map(c => (c.RowIndex || 0) + (c.rowSpan || 1) - 1));
      const maxCol = Math.max(0, ...allCells.map(c => (c.ColumnIndex || 0) + (c.colSpan || 1) - 1));
      const grid = Array.from({ length: maxRow }, () => Array(maxCol).fill(null));
      allCells.forEach(cell => {
        const r = (cell.RowIndex || 1) - 1; 
        const c = (cell.ColumnIndex || 1) - 1;
        if(grid[r] && grid[r][c] === null) {
          grid[r][c] = { id: cell.id, rowSpan: cell.rowSpan, colSpan: cell.colSpan, text: cell.text, isHeader: (cell.RowIndex === 1 || cell.ColumnIndex === 1) };
          for (let dr = 0; dr < cell.rowSpan; dr++) { 
            for (let dc = 0; dc < cell.colSpan; dc++) { 
              if (dr !== 0 || dc !== 0) { 
                if (grid[r + dr] && grid[r+dr][c+dc] !== undefined) { 
                  grid[r + dr][c + dc] = { spanned: true }; 
                } 
              } 
            }
          }
        }
      });
      return { id: table.Id, grid };
    }).filter(Boolean);
    if(isAnnotation) return parsed;
    setTables(parsed);
  }
  
  // --- EVENT HANDLERS ---
  const handleBlockClick = (blockId) => {
    const root = cellMergedMap.get(blockId) || blockId;
    setSelectedBlockId(prev => prev === root ? null : root);
    setTimeout(() => {
      const targetElement = document.getElementById(`cell-${root}`);
      if (targetElement) { targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); }
    }, 50);
    if (transformComponentRef.current) {
        const { zoomToElement } = transformComponentRef.current;
        const boundingBoxId = `bbox-${root}`;
        zoomToElement(boundingBoxId, 1.5, 200, 'easeOut');
    }
  };

  const resetState = () => { 
    setTextractData(null); 
    setTables([]); 
    setError(''); 
    setSuccess(''); 
    setSelectedBlockId(null); 
    setSensorTags(new Map()); 
    setShowCoverage(false); 
    setCustomCells([]); 
    annotatedSections.forEach(section => URL.revokeObjectURL(section.croppedImage));
    setAnnotatedSections([]); 
    setIsAnnotating(false); 
    if (croppedImage) URL.revokeObjectURL(croppedImage);
    setCroppedImage(null); 
    setCropPixels(null); 
  }

  const onFileChange = e => { 
      const f = e.target.files[0]; 
      if (!f) return; 
      setImageFile(f); 
      setImageUrl(URL.createObjectURL(f)); // The useEffect for imageUrl will handle cleanup
      resetState(); 
  };

  const onUpload = () => fileInputRef.current?.click();
  const onAnalyze = async () => {
    if (!imageFile) { setError('Select a document first.'); return; }
    setLoading(true);
    setError(''); setSuccess(''); setTables([]); setSelectedBlockId(null); setSensorTags(new Map()); setCustomCells([]);
    try {
      const fd = new FormData(); fd.append('file', imageFile);
      const resp = await fetch('http://127.0.0.1:5001/api/analyze',{method:'POST',body:fd});
      const data = await resp.json(); if (!resp.ok) throw new Error(data.error || 'Analysis failed');
      setTextractData(data); 
      parseAndBuildTables(data); 
      setSuccess('Analysis successful');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  
  const handleTagChange = (cellId, newTag) => { const newTags = new Map(sensorTags); newTags.set(cellId, newTag); setSensorTags(newTags); };
  const handleTagInputKeyDown = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { setActiveTaggingCell(null); } };
  const handleDeleteTag = (cellId) => { const newTags = new Map(sensorTags); newTags.delete(cellId); setSensorTags(newTags); };
  
  const handleSaveTags = async () => {
    setIsSaving(true); setSuccess(''); setError('');
    const taggedPayload = Array.from(sensorTags.entries()).filter(([, tag]) => tag.trim() !== "").map(([blockId, sensorTag]) => { let cellText = ''; for (const table of tables) { for (const row of table.grid) { const foundCell = row.find(cell => cell && cell.id === blockId); if (foundCell) { cellText = foundCell.text; break; } } if (cellText) break; } return { blockId: blockId, cellText: cellText.trim(), sensorTag: sensorTag, isCustom: false }; });
    const customPayload = customCells.map(cell => ({ blockId: cell.id, label: cell.label, valueType: cell.valueType, sensorTag: cell.sensorTag, isCustom: true }));
    const finalPayload = [...taggedPayload, ...customPayload];
    console.log("--- Sending to Backend ---"); console.log(JSON.stringify(finalPayload, null, 2));
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false); setSuccess(`${finalPayload.length} total entries saved successfully!`);
  };

  const handleAddCustomCell = (newCell) => { setCustomCells(prev => [...prev, newCell]); setIsAddModalOpen(false); };
  const handleDeleteCustomCell = (idToDelete) => { setCustomCells(prev => prev.filter(cell => cell.id !== idToDelete)); };

  const showCroppedImage = useCallback(async () => {
    if (!cropPixels) return;
    try {
      if (croppedImage) {
        URL.revokeObjectURL(croppedImage);
      }
      const croppedImageResult = await getCroppedImg(imageUrl, cropPixels);
      setCroppedImage(croppedImageResult);
    } catch (e) { console.error(e); }
  }, [imageUrl, cropPixels, croppedImage]);
  
  const handleRetryCrop = () => {
    if (croppedImage) {
      URL.revokeObjectURL(croppedImage);
    }
    setCroppedImage(null);
    setCropPixels(null);
    setAnnotationKey(Date.now());
  };

  const handleConfirmAndAnalyzeCrop = async () => {
    if (!croppedImage) return;
    
    setIsProcessingCrop(true);
    setError('');
    
    try {
      const imageBlob = await fetch(croppedImage).then(r => r.blob());
      const fd = new FormData();
      fd.append('file', imageBlob, 'cropped-image.jpeg');
      
      const resp = await fetch('http://127.0.0.1:5001/api/analyze',{method:'POST',body:fd});
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Analysis failed');

      const extractedTables = parseAndBuildTables(data, true);

      const newSection = {
        id: `anno-${Date.now()}`,
        croppedImage: croppedImage,
        tables: extractedTables,
      };

      if (!textractData) {
        setTextractData(data);
        setTables(extractedTables);
        setAnnotatedSections([newSection]);
        setSuccess('Annotated area analyzed successfully!');
      } else {
        setAnnotatedSections(prev => [...prev, newSection]);
        setSuccess('New annotated section added!');
      }
      
      setCroppedImage(null); // The URL is now owned by annotatedSections
      setIsAnnotating(false);
      setCropPixels(null);

    } catch(e) {
      setError(`Cropped area analysis failed: ${e.message}`);
      if (croppedImage) {
        URL.revokeObjectURL(croppedImage);
      }
      setCroppedImage(null);
    } finally {
      setIsProcessingCrop(false);
    }
  };

  const renderBoundingBoxes = () => {
    if (!blocksMap.size) return null;
    const uniqueRootBlocks = new Map();
    blocksMap.forEach(block => {
        if(block.BlockType === 'CELL' || block.BlockType === 'MERGED_CELL') {
            const rootId = cellMergedMap.get(block.Id) || block.Id;
            if (!uniqueRootBlocks.has(rootId)) {
                uniqueRootBlocks.set(rootId, blocksMap.get(rootId));
            }
        }
    });

    return Array.from(uniqueRootBlocks.values()).map(block => {
        const { BoundingBox } = block.Geometry;
        const isSel = selectedBlockId === block.Id;
        const hasTag = sensorTags.has(block.Id) && sensorTags.get(block.Id).trim() !== '';
        const boxClasses = `bounding-box ${isSel ? 'selected' : ''} ${showCoverage ? 'coverage-visible' : ''} ${hasTag ? 'tagged' : ''}`;
        const style = { top: `${BoundingBox.Top*100}%`, left: `${BoundingBox.Left*100}%`, width: `${BoundingBox.Width*100}%`, height: `${BoundingBox.Height*100}%`};
        return <div id={`bbox-${block.Id}`} key={block.Id} className={boxClasses} style={style} onClick={() => handleBlockClick(block.Id)} />;
    });
  };
  
  const renderTablesSection = () => {
    return (
        <>
            {tables.length > 0 &&
            <>
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
                            <td id={`cell-${cell.id}`} key={cell.id} rowSpan={cell.rowSpan} colSpan={cell.colSpan} className={['cell', isSel ? 'selected-row' : '', isTaggable ? 'taggable-cell' : ''].join(' ')} onClick={() => { handleBlockClick(cell.id); if(isTaggable) setActiveTaggingCell(cell.id); }}>
                                {activeTaggingCell === cell.id ? (
                                    <div className="cell-content-editing"><Tag size={16} className="tag-icon"/><input type="text" className="tag-input" placeholder="Enter sensor tag..." value={sensorTags.get(cell.id) || ''} onChange={(e) => handleTagChange(cell.id, e.target.value)} onKeyDown={handleTagInputKeyDown} onBlur={() => setActiveTaggingCell(null)} autoFocus /></div>
                                ) : (
                                    <div className="cell-content"><span className="cell-text">{cell.text}</span>{sensorTags.has(cell.id) && sensorTags.get(cell.id) && <span className="sensor-tag-badge"><Tag size={12} />{sensorTags.get(cell.id)}<button className="delete-tag-btn" onClick={(e) => { e.stopPropagation(); handleDeleteTag(cell.id); }}><X size={12}/></button></span>}</div>
                                )}
                            </td>
                            );
                        })}
                        </tr>
                    ))}
                    </tbody></table>
                </div>
                ))}
            </>
            }
            
            {customCells.length > 0 && (
                <div className="custom-cells-section">
                    <h4 className="custom-cells-title">Manually Added Fields</h4>
                    <table className="results-table custom-table">
                        <thead><tr><th>Label / Context</th><th>Datatype</th><th>Sensor Tag</th><th>Action</th></tr></thead>
                        <tbody>
                            {customCells.map(cell => (<tr key={cell.id}><td>{cell.label}</td><td><span className="datatype-badge">{cell.valueType}</span></td><td>{cell.sensorTag}</td><td><button className="delete-custom-btn" onClick={() => handleDeleteCustomCell(cell.id)}><X size={14} /></button></td></tr>))}
                        </tbody>
                    </table>
                </div>
            )}

            {annotatedSections.length > 0 && (
                <div className="annotated-results-section">
                <h3 className="section-title annotated-title">Annotated Sections</h3>
                {annotatedSections.map(section => (
                    <div key={section.id} className="annotated-item">
                    <div className="annotated-image-preview"><img src={section.croppedImage} alt="Annotated crop"/></div>
                    <div className="annotated-tables">
                        {section.tables.length > 0 ? (
                        section.tables.map(table => (
                            <table key={table.id} className="results-table mini-table">
                            <tbody>
                                {table.grid.map((row, ri) => (
                                <tr key={ri}>{row.map((cell, ci) => cell && !cell.spanned ? <td key={`${ri}-${ci}`} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{cell.text}</td>: null)}</tr>
                                ))}
                            </tbody>
                            </table>
                        ))
                        ) : <p className="no-data-found">No tables found in this section.</p>}
                    </div>
                    </div>
                ))}
                </div>
            )}
        </>
    );
  };

  return (
    <div className="App">
      {isAddModalOpen && <AddCellModal onSave={handleAddCustomCell} onCancel={() => setIsAddModalOpen(false)} />}
      
      {croppedImage && (
          <div className="modal-backdrop-light">
              <div className="annotation-confirm-dialog">
                  <h4>Confirm Crop</h4>
                  <img src={croppedImage} alt="Cropped preview"/>
                  <div className="form-actions"><button className="btn btn-retry" onClick={handleRetryCrop} disabled={isProcessingCrop}><RefreshCw size={16}/> Retry Crop</button><button className="btn btn-save" onClick={handleConfirmAndAnalyzeCrop} disabled={isProcessingCrop}>{isProcessingCrop ? <><Loader className="animate-spin" size={16}/> Analyzing...</> : <><Check size={16}/> Confirm & Analyze</>}</button></div>
              </div>
          </div>
      )}

      <header className="App-header">
        <div className="header-main">
            <h1>Document Intelligence Platform</h1>
            <div className="controls">
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={onFileChange} style={{ display:'none' }}/>
                <button className="btn btn-upload" onClick={onUpload}><Upload size={18}/> {imageFile?'Change Document':'Upload Document'}</button>
                <button className={`btn btn-analyze ${(!imageFile||loading)?'disabled':''}`} onClick={onAnalyze} disabled={!imageFile||loading}>{loading?<><Loader className="animate-spin" size={18}/> Analyzing...</>:<><FileText size={18}/> Analyze</>}
                </button>
            </div>
        </div>
        <div className="header-alerts">
            {error && <div className="alert error-state"><AlertCircle size={20}/> {error}</div>}
            {success && <div className="alert success-state"><CheckCircle size={20}/> {success}</div>}
        </div>
      </header>
      
      <main className="App-main">
        <section className={`panel image-section ${isAnnotating ? 'annotating' : ''}`}>
          <div className="panel-header">
            <h2 className="section-title"><Eye size={20}/> Document Preview</h2>
            {imageUrl && (
              <div className="view-controls">
                <label className="toggle-control"><input type="checkbox" checked={showCoverage} onChange={e => setShowCoverage(e.target.checked)} /> Show Coverage</label>
                <button className="btn btn-annotate" onClick={() => { setIsAnnotating(true); setAnnotationKey(Date.now()); }} disabled={isAnnotating}>
                  <Scissors size={16}/> Annotate
                </button>
              </div>
            )}
          </div>
          <div className="image-preview-wrapper">
            {imageUrl? (
              isAnnotating ? (
                <>
                  <div className="annotation-banner">
                    <p>Click and drag to select a missing area</p>
                    <div className="form-actions">
                        <button className="btn btn-cancel" onClick={() => { setIsAnnotating(false); setCropPixels(null); setAnnotationKey(Date.now()); }}>Cancel</button>
                        <button className="btn btn-save" onClick={showCroppedImage} disabled={!cropPixels}>Crop</button>
                    </div>
                  </div>
                  <AnnotationCanvas 
                    key={annotationKey}
                    imageUrl={imageUrl}
                    onCropStart={() => setCropPixels(null)}
                    onCropComplete={(pixels) => setCropPixels(pixels)}
                  />
                </>
              ) : (
                <TransformWrapper key={imageUrl} ref={transformComponentRef} options={{limitToBounds:false}} pan={{velocity:true}} wheel={{step:0.2}} doubleClick={{disabled:true}} zoomAnimation={{animationTime:200}}>
                  {({zoomIn,zoomOut,resetTransform})=><>
                    <div className="zoom-controls"><button onClick={()=>zoomIn(0.2)}><ZoomIn size={18}/></button><button onClick={()=>zoomOut(0.2)}><ZoomOut size={18}/></button><button onClick={()=>resetTransform()}><RotateCcw size={18}/></button></div>
                    <TransformComponent wrapperClass="transform-wrapper"><img ref={imageRef} src={imageUrl} alt="Preview" className="preview-image"/>{renderBoundingBoxes()}</TransformComponent>
                  </>}
                </TransformWrapper>
              )
            ) : <div className="empty-state"><FileText size={40}/><p>Upload a document to begin.</p></div>}
          </div>
        </section>
        <section className="panel results-section">
          <div className="panel-header">
            <h2 className="section-title"><Table size={20}/> Extracted Data</h2>
            {(textractData || customCells.length > 0) && (
                <div className="view-controls">
                    <button className="btn btn-add" onClick={() => setIsAddModalOpen(true)}><PlusCircle size={16}/> Add Field</button>
                    <button className="btn btn-save" onClick={handleSaveTags} disabled={isSaving || (sensorTags.size === 0 && customCells.length === 0)}><Save size={16}/>{isSaving ? "Saving..." : "Save All"}</button>
                </div>
            )}
          </div>
          <div className="results-content">
            {loading?<div className="loading-overlay"><Loader size={40} className="animate-spin"/></div>
            : (textractData || customCells.length > 0 || annotatedSections.length > 0) ? renderTablesSection() : <div className="empty-state"><Eye size={40}/><p>Extracted tables will appear here.</p></div>}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;