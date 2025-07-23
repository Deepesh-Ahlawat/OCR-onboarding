import React from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

function DocumentPreview({ document, title, selectedBlockId, showCoverage, sensorTags, handleBlockClick }) {

  const handleImageLoad = (controls) => {
    // This function is called when the image finishes loading.
    // It receives the library's controls directly, guaranteeing they are ready.
    if (controls && controls.resetTransform) {
      controls.resetTransform(0); // 0ms animation time
    }
  };

  const renderBoundingBoxes = () => {
    if (!document.blocksMap || !document.blocksMap.size) return null;

    return Array.from(document.blocksMap.values()).map(block => {
      if (block.BlockType !== 'CELL' && block.BlockType !== 'MERGED_CELL') {
        return null;
      }
      
      const { BoundingBox } = block.Geometry;
      const isSel = selectedBlockId === block.Id;
      const hasTag = sensorTags.has(block.Id) && sensorTags.get(block.Id).trim() !== '';
      const boxClasses = `bounding-box ${isSel ? 'selected' : ''} ${showCoverage ? 'coverage-visible' : ''} ${hasTag ? 'tagged' : ''}`;
      
      const style = { 
        top: `${BoundingBox.Top*100}%`, 
        left: `${BoundingBox.Left*100}%`, 
        width: `${BoundingBox.Width*100}%`, 
        height: `${BoundingBox.Height*100}%`
      };
      
      return <div id={`bbox-${block.Id}`} key={block.Id} className={boxClasses} style={style} onClick={() => handleBlockClick(block.Id)} />;
    });
  };

  return (
    <>
      <h3 className="document-title">{title}</h3>
      <div className="image-preview-wrapper">
        {/*
          We pass the library's controls from onInit directly into the onLoad handler of the image.
          This creates a reliable chain of events:
          1. Library initializes, gives us `controls`.
          2. Image loads, calls `handleImageLoad` with the `controls`.
          3. `handleImageLoad` safely resizes the view.
        */}
        <TransformWrapper key={document.id} ref={document.transformRef} options={{limitToBounds:false}} pan={{velocity:true}} wheel={{step:0.2}} doubleClick={{disabled:true}} zoomAnimation={{animationTime:200}}>
          {(controls)=><>
            <div className="zoom-controls">
                <button onClick={()=>controls.zoomIn(0.2)}><ZoomIn size={18}/></button>
                <button onClick={()=>controls.zoomOut(0.2)}><ZoomOut size={18}/></button>
                <button onClick={()=>controls.resetTransform()}><RotateCcw size={18}/></button>
            </div>
            <TransformComponent wrapperClass="transform-wrapper">
                <img 
                    src={document.imageUrl} 
                    alt={title} 
                    className="preview-image"
                    onLoad={() => handleImageLoad(controls)} 
                />
                {renderBoundingBoxes()}
            </TransformComponent>
          </>}
        </TransformWrapper>
      </div>
    </>
  );
}

export default DocumentPreview;