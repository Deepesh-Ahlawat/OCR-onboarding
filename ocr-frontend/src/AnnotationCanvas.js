import React, { useState, useRef, useCallback } from 'react';

function AnnotationCanvas({ imageUrl, onCropComplete, onCropStart }) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [cropArea, setCropArea] = useState({ x: 0, y: 0, width: 0, height: 0 });
  
  const containerRef = useRef(null);
  const imageRef = useRef(null);

  const getRelativeCoords = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    const point = getRelativeCoords(e);
    setStartPoint(point);
    setCropArea({ ...point, width: 0, height: 0 });
    if (onCropStart) onCropStart();
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    const endPoint = getRelativeCoords(e);
    const newCropArea = {
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y),
    };
    setCropArea(newCropArea);
  };

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const imageEl = imageRef.current;
    if (!imageEl) return;
    
    // --- START: ACCURATE COORDINATE TRANSLATION LOGIC ---

    // Get original image dimensions
    const naturalWidth = imageEl.naturalWidth;
    const naturalHeight = imageEl.naturalHeight;
    // Get displayed image container dimensions
    const clientWidth = imageEl.clientWidth;
    const clientHeight = imageEl.clientHeight;

    // Calculate aspect ratios
    const naturalRatio = naturalWidth / naturalHeight;
    const clientRatio = clientWidth / clientHeight;

    let renderedWidth, renderedHeight, offsetX, offsetY;

    // Determine the actual rendered dimensions and offsets caused by 'object-fit: contain'
    if (naturalRatio > clientRatio) {
        // Image is wider than its container, so it's constrained by width.
        // This results in letterboxing (padding on top and bottom).
        renderedWidth = clientWidth;
        renderedHeight = clientWidth / naturalRatio;
        offsetX = 0;
        offsetY = (clientHeight - renderedHeight) / 2;
    } else {
        // Image is taller than its container, so it's constrained by height.
        // This results in pillarboxing (padding on left and right).
        renderedHeight = clientHeight;
        renderedWidth = clientHeight * naturalRatio;
        offsetY = 0;
        offsetX = (clientWidth - renderedWidth) / 2;
    }

    // Calculate the single, correct scale factor
    const scale = naturalWidth / renderedWidth;

    // 1. Adjust the drawn rectangle to be relative to the *actual image*, not the padded container.
    // 2. Scale the adjusted coordinates up to the original image's dimensions.
    const finalCropPixels = {
        x: Math.round((cropArea.x - offsetX) * scale),
        y: Math.round((cropArea.y - offsetY) * scale),
        width: Math.round(cropArea.width * scale),
        height: Math.round(cropArea.height * scale)
    };
    
    // --- END: ACCURATE COORDINATE TRANSLATION LOGIC ---

    // Only fire the event if a rectangle of a meaningful size was drawn
    if (finalCropPixels.width > 5 && finalCropPixels.height > 5) {
        onCropComplete(finalCropPixels);
    } else {
        setCropArea({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, [isDrawing, cropArea, startPoint, onCropComplete]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', cursor: 'crosshair', overflow: 'hidden' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <img
        ref={imageRef}
        src={imageUrl}
        alt="Document for annotation"
        style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', userSelect: 'none' }}
      />
      {cropArea.width > 0 && (
        <div
          style={{
            position: 'absolute',
            left: `${cropArea.x}px`,
            top: `${cropArea.y}px`,
            width: `${cropArea.width}px`,
            height: `${cropArea.height}px`,
            border: '2px dashed #ffffff',
            backgroundColor: 'rgba(79, 70, 229, 0.3)',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}

export default AnnotationCanvas;