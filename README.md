# OCR Onboarding Project

## Overview

This project is an OCR (Optical Character Recognition) tool for onboarding processes. It consists of:
- **Backend**: A Flask server that uses AWS Textract to analyze uploaded images, extracting forms and tables.
- **Frontend**: A React application for uploading images, displaying analysis results with bounding boxes, and allowing editable form/table data.

The backend processes images via the `/api/analyze` endpoint, and the frontend provides an interactive UI for review and editing.

## Prerequisites

- Python 3.x for the backend.
- Node.js and npm for the frontend.
- AWS account with Textract access. Configure AWS credentials using `aws configure` (requires AWS CLI).

## Setup

1. **Clone the repository** (if applicable).

2. **Backend Setup**:
   - Navigate to `ocr-backend/`.
   - Install dependencies: `pip install -r requirements.txt`.
   - Run the server: `python app.py` (runs on http://localhost:5001).

3. **Frontend Setup**:
   - Navigate to `ocr-frontend/`.
   - Install dependencies: `npm install`.
   - Run the app: `npm start` (runs on http://localhost:3000).

## Usage

1. Open the frontend in your browser.
2. Upload an image (PNG/JPG).
3. Click "Analyze Document" to process via AWS Textract.
4. View extracted form data and tables with editable fields.
5. Click on bounding boxes or table rows to highlight selections.

## Project Structure

- `ocr-backend/`: Flask app with Textract integration.
- `ocr-frontend/`: React app for UI.
- `requirements.txt`: Backend dependencies.
- `.gitignore`: Ignores for Git.

## Dependencies

- Backend: Flask, flask-cors, boto3.
- Frontend: React, axios (see `package.json`).

## Notes

- Ensure CORS is handled (already enabled in backend).
- For production, secure AWS credentials and consider environment variables.
- Debug mode is enabled in development.