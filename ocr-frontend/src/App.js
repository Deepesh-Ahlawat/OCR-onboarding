import React, { useState, useRef, useEffect, useCallback, createRef } from 'react';
import { Upload, FileText, Eye, AlertCircle, CheckCircle, Loader, Table, Save, Tag, X, PlusCircle, Scissors, Check, RefreshCw } from 'lucide-react';
import './App.css';
import { getCroppedImg } from './cropImage';
import AnnotationCanvas from './AnnotationCanvas';
import DocumentPreview from './DocumentPreview';

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
        const newCell = { id: `custom-${Date.now()}`, label: formData.get('label'), valueType: formData.get('valueType'), sensorTag: formData.get('sensorTag') };
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

// --- CONSTANTS ---
const API_URL = 'http://127.0.0.1:5001/api/analyze';

function App() {
  // --- STATE ---
  const [imageFile, setImageFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [masterBlocksMap, setMasterBlocksMap] = useState(new Map());
  const [blockToDocumentMap, setBlockToDocumentMap] = useState(new Map());
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
  const [headerMap, setHeaderMap] = useState(new Map());
  const [rawAiResponse, setRawAiResponse] = useState('');
  const [cropPixels, setCropPixels] = useState(null);
  const [croppedImage, setCroppedImage] = useState(null);
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);
  const [annotationKey, setAnnotationKey] = useState(Date.now());

  const fileInputRef = useRef(null);

  // --- LIFECYCLE HOOKS ---
  useEffect(() => {
    return () => {
      documents.forEach(doc => URL.revokeObjectURL(doc.imageUrl));
      if (croppedImage) URL.revokeObjectURL(croppedImage);
    };
  }, []);

  // --- DATA PROCESSING ---
  const parseAndBuildTables = (jsonData, currentMasterMap) => {
    const Blocks = jsonData?.Blocks || [];
    if (!Blocks.length) return [];
    
    const localMap = new Map(Blocks.map(b => [b.Id, b]));
    const fullMap = new Map([...currentMasterMap, ...localMap]);
    
    const tablesRaw = Blocks.filter(b => b.BlockType === 'TABLE');
    return tablesRaw.map(table => {
      const childRel = table.Relationships?.find(r => r.Type === 'CHILD');
      const cellIds = childRel?.Ids || [];
      if (!cellIds.length) return null;
      
      const mergedBlocks = Blocks.filter(b => b.BlockType === 'MERGED_CELL' && b.Relationships?.find(r => r.Type === 'CHILD')?.Ids.some(id => cellIds.includes(id)));
      const mergedChildIds = new Set(mergedBlocks.flatMap(mb => mb.Relationships.find(r => r.Type === 'CHILD').Ids));

      const synthetic = mergedBlocks.map(mb => {
        const childRel = mb.Relationships?.find(r => r.Type === 'CHILD');
        const childIds = childRel?.Ids || [];
        const mergedText = childIds.map(cid => { const childBlock = fullMap.get(cid); return childBlock ? getText(childBlock, fullMap) : ''; }).filter(t => t.trim().length > 0).join(' ');
        return { id: mb.Id, RowIndex: mb.RowIndex, ColumnIndex: mb.ColumnIndex, rowSpan: mb.RowSpan || 1, colSpan: mb.ColumnSpan || 1, text: mergedText || ' ' };
      });
      
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
  }

    // --- EVENT HANDLERS ---
  const handleBlockClick = (blockId) => {
    const docId = blockToDocumentMap.get(blockId);
    if (!docId) return;

    setSelectedBlockId(prev => prev === blockId ? null : blockId);
    
    const targetDoc = documents.find(d => d.id === docId);
    if (!targetDoc || !targetDoc.transformRef.current) return;
    
    const previewContainer = document.querySelector('.previews-wrapper');
    const previewElement = document.getElementById(`preview-container-${docId}`);
    if (previewContainer && previewElement) {
        const containerRect = previewContainer.getBoundingClientRect();
        const elementRect = previewElement.getBoundingClientRect();
        const scrollOffset = elementRect.top - containerRect.top + previewContainer.scrollTop - 20;
        previewContainer.scrollTo({ top: scrollOffset, behavior: 'smooth' });
    }

    setTimeout(() => {
        // The controls are now directly on the ref's `current` property
        if (targetDoc.transformRef.current) {
            targetDoc.transformRef.current.zoomToElement(`bbox-${blockId}`, 1.8, 200, 'easeOut');
        }
    }, 300);
  };
  
  const resetState = () => {
    documents.forEach(doc => URL.revokeObjectURL(doc.imageUrl));
    setDocuments([]);
    setMasterBlocksMap(new Map());
    setBlockToDocumentMap(new Map());
    setTables([]);
    setCustomCells([]);
    setSensorTags(new Map());
    if (croppedImage) URL.revokeObjectURL(croppedImage);
    setCroppedImage(null);
  };

  const onFileChange = e => { 
    const f = e.target.files[0]; 
    if (!f) return; 
    
    resetState();
    setImageFile(f); 
    setDocuments([{
        id: 'main',
        imageUrl: URL.createObjectURL(f),
        blocksMap: new Map(),
        transformRef: createRef()
    }]);
  };
  
  // In App.js, add this new function

const performVisionAnalysis = async (imageSource, isAnnotation = false) => {
  setLoading(true);
  setError('');
  
  const fd = new FormData();
  fd.append('file', imageSource);

  try {
    const resp = await fetch('http://127.0.0.1:5001/api/analyze-document-vision', {
      method: 'POST',
      body: fd,
    });

    if (!resp.ok) {
      const errorData = await resp.json();
      throw new Error(errorData.error || 'Analysis failed');
    }

    const data = await resp.json();
    const textractResponse = data.textractResponse;
    const aiResponseString = data.aiHeaderAnalysis;

    // --- Process Textract Data ---
    const newBlocks = textractResponse.Blocks || [];
    if (newBlocks.length === 0) {
        throw new Error("Textract did not find any content in the provided area.");
    }
    const newBlocksMap = new Map(newBlocks.map(b => [b.Id, b]));
    
    // Merge new blocks with master map
    setMasterBlocksMap(prev => new Map([...prev, ...newBlocksMap]));
    
    // Add new tables to the existing list
    const newTables = parseAndBuildTables(textractResponse, newBlocksMap);
    setTables(prev => [...prev, ...newTables]);

    // Handle document source for annotations
    if (isAnnotation) {
        const docId = `anno-${Date.now()}`;
        setBlockToDocumentMap(prev => {
            const newMap = new Map(prev);
            newBlocks.forEach(b => newMap.set(b.Id, docId));
            return newMap;
        });
        const newDocument = {
            id: docId,
            imageUrl: URL.createObjectURL(imageSource), // Create a URL for the preview
            blocksMap: newBlocksMap,
            transformRef: createRef()
        };
        setDocuments(prev => [...prev, newDocument]);
    } else { // For initial analysis
        setBlockToDocumentMap(prev => {
            const newMap = new Map(prev);
            newBlocks.forEach(b => newMap.set(b.Id, 'main'));
            return newMap;
        });
        setDocuments(prevDocs => prevDocs.map(doc =>
            doc.id === 'main' ? { ...doc, blocksMap: newBlocksMap } : doc
        ));
    }

    // --- Process Vision AI Data ---
    if (aiResponseString) {
      console.log(`--- RAW AI VISION RESPONSE (${isAnnotation ? 'Annotation' : 'Initial'}) ---`);
      console.log(aiResponseString);
      setRawAiResponse(prev => prev + '\n' + aiResponseString); // Append new results

      try {
        const parsedResult = JSON.parse(aiResponseString);
        setHeaderMap(prevMap => {
          const newMap = new Map(prevMap);
          for (const [cellId, headers] of Object.entries(parsedResult)) {
            if (headers.rowHeader && headers.colHeader) {
              newMap.set(cellId, headers);
            }
          }
          return newMap;
        });
      } catch (e) {
        console.error("Failed to parse AI Vision response for annotation:", e);
        // Don't throw an error, just log it. The Textract data is still valuable.
      }
    }
    
    return true; // Indicate success

  } catch (e) {
    setError(e.message);
    return false; // Indicate failure
  } finally {
    setLoading(false);
  }
};

  const onAnalyze = async () => {
  if (!imageFile) {
    setError('Select a document first.');
    return;
  }
  
  // Reset everything for the new analysis
  setLoading(true);
  setError('');
  setSuccess('');
  setRawAiResponse('');
  setTables([]);
  setMasterBlocksMap(new Map());
  setHeaderMap(new Map());

  // --- STEP 1: FAST TEXTRACT ANALYSIS ---
  const fdTextract = new FormData();
  fdTextract.append('file', imageFile);

  try {
    const textractResp = await fetch('http://127.0.0.1:5001/api/analyze', {
      method: 'POST',
      body: fdTextract,
    });
    if (!textractResp.ok) {
        const errorData = await textractResp.json();
        throw new Error(errorData.error || 'Textract analysis failed');
    }
    
    const textractData = await textractResp.json();

    // PROCESS AND DISPLAY TEXTRACT RESULTS IMMEDIATELY
    const newBlocks = textractData.Blocks || [];
    const newBlocksMap = new Map(newBlocks.map(b => [b.Id, b]));
    setMasterBlocksMap(newBlocksMap);

    setBlockToDocumentMap(new Map(newBlocks.map(b => [b.Id, 'main'])));
    setDocuments(prevDocs => prevDocs.map(doc =>
      doc.id === 'main' ? { ...doc, blocksMap: newBlocksMap } : doc
    ));

    const newTables = parseAndBuildTables(textractData, newBlocksMap);
    setTables(newTables);
    
    setLoading(false); // Stop the main loader
    setSuccess('Document structure extracted. Analyzing context with AI in background...');

    // --- STEP 2: SLOW VISION ANALYSIS (RUNS IN BACKGROUND) ---
    // Prepare data for the vision API call
    const allSimplifiedCells = [];
    newTables.forEach(table => {
        if (!table || !table.grid) return;
        table.grid.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                if (cell && !cell.spanned) {
                    allSimplifiedCells.push({
                        cellId: cell.id,
                        text: cell.text.trim(),
                    });
                }
            });
        });
    });

    const fdVision = new FormData();
    fdVision.append('file', imageFile);
    fdVision.append('simplified_cells', JSON.stringify(allSimplifiedCells));

    // Make the second API call without blocking the UI
    fetch('http://127.0.0.1:5001/api/analyze-vision-context', {
      method: 'POST',
      body: fdVision,
    })
    .then(response => {
        if (!response.ok) { throw new Error('AI Vision analysis failed.'); }
        return response.json();
    })
    .then(visionData => {
        const aiResponseString = visionData.aiHeaderAnalysis;
        console.log("--- RAW AI VISION RESPONSE RECEIVED ---");
        console.log(aiResponseString);
        setRawAiResponse(aiResponseString);
        setSuccess('AI context analysis complete!');
        try {
        const parsedResultArray = JSON.parse(aiResponseString);

        // Check if the response is an array before proceeding
        if (Array.isArray(parsedResultArray)) {
            setHeaderMap(prevMap => {
                const newMap = new Map(prevMap);
                
                // Iterate over the array of objects
                parsedResultArray.forEach(item => {
                    // Make sure the item has the expected structure
                    if (item.cellId && item.headers && item.headers.row && item.headers.col) {
                        newMap.set(item.cellId, {
                            rowHeader: item.headers.row,
                            colHeader: item.headers.col
                        });
                    }
                });
                
                console.log("HeaderMap successfully updated with AI data.");
                return newMap;
            });
        } else {
            // Log an error if the format is not the expected array
            console.error("AI response was not in the expected array format:", parsedResultArray);
            setError("AI analysis returned an unexpected format.");
        }
    } catch (e) {
        console.error("Failed to parse AI Vision response:", e);
        setError("AI analysis returned an invalid format.");
    }
    })
    .catch(err => {
        console.error("Background AI analysis failed:", err);
        // Display a non-critical error to the user
        setError(`Background AI analysis failed: ${err.message}`);
    });

  } catch (e) {
    setError(e.message);
    setLoading(false);
  }
};


  const handleConfirmAndAnalyzeCrop = async () => {
  if (!croppedImage) return;
  setIsProcessingCrop(true); // Use the dedicated loader for the modal

  try {
    const imageBlob = await fetch(croppedImage).then(r => r.blob());
    const imageFileFromBlob = new File([imageBlob], "annotated-crop.jpg", { type: "image/jpeg" });

    // --- STEP 1: FAST TEXTRACT ANALYSIS FOR THE CROP ---
    const fdTextract = new FormData();
    fdTextract.append('file', imageFileFromBlob);

    const textractResp = await fetch('http://127.0.0.1:5001/api/analyze', {
      method: 'POST',
      body: fdTextract,
    });

    if (!textractResp.ok) {
      const errorData = await textractResp.json();
      throw new Error(errorData.error || 'Cropped area analysis failed');
    }

    const textractData = await textractResp.json();

    // PROCESS AND DISPLAY THE NEW ANNOTATED TABLE IMMEDIATELY
    const newBlocks = textractData.Blocks || [];
    if (newBlocks.length === 0) {
        throw new Error("Textract did not find any content in the annotated area.");
    }
    const newBlocksMap = new Map(newBlocks.map(b => [b.Id, b]));
    setMasterBlocksMap(prev => new Map([...prev, ...newBlocksMap]));

    const newTables = parseAndBuildTables(textractData, newBlocksMap);
    setTables(prev => [...prev, ...newTables]);

    const docId = `anno-${Date.now()}`;
    setBlockToDocumentMap(prev => {
        const newMap = new Map(prev);
        newBlocks.forEach(b => newMap.set(b.Id, docId));
        return newMap;
    });

    // We need to create a URL for the preview image.
    // Since `croppedImage` is a temporary URL, let's pass the blob directly
    // to avoid revoking it too early.
    const newDocument = {
        id: docId,
        imageUrl: URL.createObjectURL(imageFileFromBlob),
        blocksMap: newBlocksMap,
        transformRef: createRef()
    };
    setDocuments(prev => [...prev, newDocument]);
    
    // UI is now updated, close the modal and show success
    setCroppedImage(null);
    setIsAnnotating(false);
    setCropPixels(null);
    setSuccess('Annotated section added. Analyzing context with AI in background...');

    // --- STEP 2: SLOW VISION ANALYSIS FOR THE CROP (RUNS IN BACKGROUND) ---
    const simplifiedCells = [];
    newTables.forEach(table => {
        if (!table || !table.grid) return;
        table.grid.forEach((row) => {
            row.forEach((cell) => {
                if (cell && !cell.spanned) {
                    simplifiedCells.push({
                        cellId: cell.id,
                        text: cell.text.trim(),
                    });
                }
            });
        });
    });

    const fdVision = new FormData();
    fdVision.append('file', imageFileFromBlob);
    fdVision.append('simplified_cells', JSON.stringify(simplifiedCells));

    // Make the second API call without blocking the UI
    fetch('http://127.0.0.1:5001/api/analyze-vision-context', {
      method: 'POST',
      body: fdVision,
    })
    .then(response => {
        if (!response.ok) { throw new Error('AI Vision analysis for annotation failed.'); }
        return response.json();
    })
    .then(visionData => {
        const aiResponseString = visionData.aiHeaderAnalysis;
        console.log("--- RAW AI VISION RESPONSE (Annotation) ---");
        console.log(aiResponseString);
        setRawAiResponse(prev => prev + '\n' + aiResponseString); //ha Append results
        setSuccess('AI context analysis for annotation complete!');
        try {
        const parsedResultArray = JSON.parse(aiResponseString);

        // Check if the response is an array before proceeding
        if (Array.isArray(parsedResultArray)) {
            setHeaderMap(prevMap => {
                const newMap = new Map(prevMap);
                
                // Iterate over the array of objects
                parsedResultArray.forEach(item => {
                    // Make sure the item has the expected structure
                    if (item.cellId && item.headers && item.headers.row && item.headers.col) {
                        newMap.set(item.cellId, {
                            rowHeader: item.headers.row,
                            colHeader: item.headers.col
                        });
                    }
                });
                
                console.log("HeaderMap successfully updated with AI data.");
                return newMap;
            });
        } else {
            // Log an error if the format is not the expected array
            console.error("AI response was not in the expected array format:", parsedResultArray);
            setError("AI analysis returned an unexpected format.");
        }
    } catch (e) {
        console.error("Failed to parse AI Vision response:", e);
        setError("AI analysis returned an invalid format.");
    }
    })
    .catch(err => {
        console.error("Background AI analysis for annotation failed:", err);
        setError(`Background AI analysis for annotation failed: ${err.message}`);
    });

  } catch (e) {
    setError(`Cropped area analysis failed: ${e.message}`);
    // Ensure modal closes even on failure
    setCroppedImage(null);
    setIsAnnotating(false);
    setCropPixels(null);
  } finally {
    setIsProcessingCrop(false);
  }
};

  const showCroppedImage = useCallback(async () => {
    const mainImageUrl = documents.find(d => d.id === 'main')?.imageUrl;
    if (!cropPixels || !mainImageUrl) return;
    try {
      if (croppedImage) URL.revokeObjectURL(croppedImage);
      const croppedImageResult = await getCroppedImg(mainImageUrl, cropPixels);
      setCroppedImage(croppedImageResult);
    } catch (e) { console.error(e); }
  }, [cropPixels, croppedImage, documents]);
  
  const handleRetryCrop = () => {
    if (croppedImage) URL.revokeObjectURL(croppedImage);
    setCroppedImage(null);
    setCropPixels(null);
    setAnnotationKey(Date.now());
  };

  const onUpload = () => fileInputRef.current?.click();
  const handleTagChange = (cellId, newTag) => { const newTags = new Map(sensorTags); newTags.set(cellId, newTag); setSensorTags(newTags); };
  const handleTagInputKeyDown = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { setActiveTaggingCell(null); } };
  const handleDeleteTag = (cellId) => { const newTags = new Map(sensorTags); newTags.delete(cellId); setSensorTags(newTags); };
  
  // In App.js, replace your existing handleSaveTags function with this one.

const handleSaveTags = async () => {
  setIsSaving(true);
  setSuccess('');
  setError('');

  // Create a master list of all cell IDs that have either a sensor tag or AI headers.
  const allCellIds = new Set([
      ...sensorTags.keys(),
      ...headerMap.keys()
  ]);

  const finalPayload = [];

  for (const blockId of allCellIds) {
    // Find the original cell block to get its text
    const block = masterBlocksMap.get(blockId);
    if (!block) continue; // Skip if block not found
    
    // This is a more robust way to find cell text
    let cellText = '';
    const foundCellInTables = tables.flatMap(t => t.grid).flat().find(c => c && c.id === blockId);
    cellText = foundCellInTables ? foundCellInTables.text.trim() : '';

    // Get data from our state maps
    const userSensorTag = sensorTags.get(blockId) || null;
    const aiHeaders = headerMap.get(blockId) || { rowHeader: null, colHeader: null };

    // We only want to save cells that have a user-assigned tag,
    // as these are the ones the user has explicitly onboarded.
    // The AI data is used to enrich this user-tagged data.
    if (userSensorTag && userSensorTag.trim() !== "") {
        finalPayload.push({
          blockId: blockId,
          cellText: cellText,
          sensorTag: userSensorTag,
          isCustom: false,
          aiContext: { // Embed the AI context
            rowHeader: aiHeaders.rowHeader,
            colHeader: aiHeaders.colHeader,
          },
        });
    }
  }

  // Also include the custom cells, which don't have AI context
  const customPayload = customCells.map(cell => ({
    blockId: cell.id,
    cellText: cell.label, // Use label as the "text"
    sensorTag: cell.sensorTag,
    isCustom: true,
    valueType: cell.valueType,
    aiContext: null,
  }));
  
  const combinedPayload = [...finalPayload, ...customPayload];

  console.log("--- Sending to Backend (Mimicked) ---");
  console.log(JSON.stringify(combinedPayload, null, 2));

  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  setIsSaving(false);
  setSuccess(`${combinedPayload.length} total entries saved successfully!`);
};
  
  const handleAddCustomCell = (newCell) => { setCustomCells(prev => [...prev, newCell]); setIsAddModalOpen(false); };
  const handleDeleteCustomCell = (idToDelete) => { setCustomCells(prev => prev.filter(cell => cell.id !== idToDelete)); };
  
  const renderTablesSection = () => {
    return (
        <>
            {tables.length > 0 &&
                tables.map((table, tableIndex) => (
                <div key={`${table.id}-${tableIndex}`} className="table-container">
                    <table className="results-table"><tbody>
                    {table.grid.map((row, ri) => (
                        <tr key={`${table.id}-row-${ri}`}>
                        {row.map((cell) => {
                            if (!cell || cell.spanned) return null;
                            const isSel = selectedBlockId === cell.id;
                            const isTaggable = !cell.isHeader && cell.text && cell.text.trim() !== ' ';
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
                ))
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
                  <div className="form-actions"><button className="btn btn-retry" onClick={handleRetryCrop} disabled={isProcessingCrop}><RefreshCw size={16}/> Retry</button><button className="btn btn-save" onClick={handleConfirmAndAnalyzeCrop} disabled={isProcessingCrop}>{isProcessingCrop ? <><Loader className="animate-spin" size={16}/> Analyzing...</> : <><Check size={16}/> Confirm</>}</button></div>
              </div>
          </div>
      )}

      <header className="App-header">
        <div className="header-main">
            <h1>OCR Onboarding Platform</h1>
            <div className="controls">
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={onFileChange} style={{ display:'none' }}/>
                <button className="btn btn-upload" onClick={onUpload}><Upload size={18}/> {imageFile?'Change Document':'Upload Document'}</button>
                <button className={`btn btn-analyze ${(!imageFile||loading)?'disabled':''}`} onClick={onAnalyze} disabled={!imageFile||loading}>
                    {loading ? (
                        <><Loader className="animate-spin" size={18}/> Analyzing...</>
                    ) : (
                        <><FileText size={18}/> Analyze</>
                    )}
                </button>
            </div>
        </div>
        <div className="header-alerts">{error && <div className="alert error-state"><AlertCircle size={20}/> {error}</div>}{success && <div className="alert success-state"><CheckCircle size={20}/> {success}</div>}</div>
      </header>
      
      <main className="App-main">
        <section className="panel image-section">
            <div className="panel-header">
                <h2 className="section-title"><Eye size={20}/> Document Preview</h2>
                {documents.length > 0 && 
                    <div className="view-controls">
                        <label className="toggle-control"><input type="checkbox" checked={showCoverage} onChange={e => setShowCoverage(e.target.checked)} /> Show Coverage</label>
                        <button className="btn btn-annotate" onClick={() => { setIsAnnotating(true); setAnnotationKey(Date.now()); }} disabled={isAnnotating}>
                            <Scissors size={16}/> Annotate
                        </button>
                    </div>
                }
            </div>
            <div className="previews-wrapper">
            {isAnnotating ? (
                <div className="image-preview-wrapper" style={{height:'100%'}}>
                    <div className="annotation-banner">
                        <p>Click and drag on the main document to select an area</p>
                        <div className="form-actions">
                            <button className="btn btn-cancel" onClick={() => { setIsAnnotating(false); setCropPixels(null); }}>Cancel</button>
                            <button className="btn btn-save" onClick={showCroppedImage} disabled={!cropPixels}>Crop</button>
                        </div>
                    </div>
                    <AnnotationCanvas 
                        key={annotationKey}
                        imageUrl={documents.find(d => d.id === 'main').imageUrl}
                        onCropStart={() => setCropPixels(null)}
                        onCropComplete={(pixels) => setCropPixels(pixels)}
                    />
                </div>
            ) : (
                <>
                    {documents.length > 0 ? (
                        documents.map((doc, index) => (
                            <div key={doc.id} id={`preview-container-${doc.id}`} className="standalone-preview">
                                <DocumentPreview
                                    document={doc}
                                    title={index === 0 ? "Original Image" : `Annotated Section ${index}`}
                                    selectedBlockId={selectedBlockId}
                                    showCoverage={showCoverage}
                                    sensorTags={sensorTags}
                                    handleBlockClick={handleBlockClick}
                                />
                            </div>
                        ))
                    ) : (
                        <div className="empty-state" style={{height:'100%', borderRadius: '0 0 12px 12px'}}><FileText size={40}/><p>Upload a document to begin.</p></div>
                    )}
                </>
            )}
            </div>
        </section>

        <section className="panel results-section">
          <div className="panel-header">
            <h2 className="section-title"><Table size={20}/> Extracted Data</h2>
            {(tables.length > 0 || customCells.length > 0) && (
                <div className="view-controls">
                    <button className="btn btn-add" onClick={() => setIsAddModalOpen(true)}><PlusCircle size={16}/> Add Field</button>
                    <button className="btn btn-save" onClick={handleSaveTags} disabled={isSaving || (sensorTags.size === 0 && customCells.length === 0)}><Save size={16}/>{isSaving ? "Saving..." : "Save All"}</button>
                </div>
            )}
          </div>
          <div className="results-content">
            {loading ? <div className="loading-overlay"><Loader size={40} className="animate-spin"/></div>
            : (tables.length > 0 || customCells.length > 0) ? renderTablesSection() : <div className="empty-state"><Eye size={40}/><p>Extracted tables will appear here.</p></div>}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;