/**
 * This function was adapted from the one in the ReadMe of https://github.com/DominicTobias/react-image-crop
 * @param {string} imageSrc - Image File url
 * @param {Object} pixelCrop - pixelCrop Object provided by react-easy-crop
 */
export async function getCroppedImg(imageSrc, pixelCrop) {
  const image = new Image();
  // Allow cross-origin images to be loaded, important for canvas security
  image.crossOrigin = 'anonymous'; 
  image.src = imageSrc;
  
  const promise = new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
  });

  const loadedImage = await promise;

  const canvas = document.createElement('canvas');
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  ctx.drawImage(
    loadedImage,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas is empty'));
        return;
      }
      // Create a new file object from the blob for consistency
      const file = new File([blob], 'cropped-image.jpeg', { type: 'image/jpeg' });
      const fileUrl = window.URL.createObjectURL(file);
      resolve(fileUrl);
    }, 'image/jpeg');
  });
}