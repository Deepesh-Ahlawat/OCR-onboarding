# Document Intelligence Platform

This project is an advanced OCR (Optical Character Recognition) platform designed to extract, analyze, and manage data from document images. It provides an interactive interface for users to verify, annotate, and tag structured data, bridging the gap between raw images and usable information.

## Key Features

-   **Seamless Document Upload**: Upload document images (PNG, JPG, etc.) through a clean user interface.
-   **AI-Powered Analysis**: Leverages AWS Textract on the backend to accurately detect and extract tables and key-value pairs from documents.
-   **Interactive Data Visualization**: Displays the uploaded image alongside the extracted data in structured tables.
-   **Two-Way Highlighting**: Click on a table cell to highlight and zoom to the corresponding bounding box on the image, and vice-versa.
-   **Manual Annotation**: Users can draw a box around any section of the document that the initial analysis missed and send just that crop for re-analysis.
-   **Multi-Document View**: The main image and all annotated sections are displayed in a single, scrollable workspace for a unified view.
-   **Data Tagging & Saving**: Assign custom sensor tags to extracted data cells for mapping to external systems.

## Technology Stack

-   **Frontend**:
    -   React (`create-react-app`)
    -   `react-zoom-pan-pinch` for interactive image controls (zoom/pan).
    -   `lucide-react` for a clean and modern icon set.
    -   Standard `fetch` API for communicating with the backend.
-   **Backend**:
    -   Flask
    -   Boto3 (AWS SDK for Python) to interface with AWS Textract.
    -   Flask-CORS for handling cross-origin requests from the frontend.

## Prerequisites

-   **Node.js**: v16.x or newer.
-   **Python**: v3.8 or newer.
-   **AWS Account**: An active AWS account with programmatic access.
-   **AWS CLI**: (Recommended) The AWS Command Line Interface, for configuring credentials easily.

---

## First-Time Setup Instructions

Follow these steps carefully to get the application running locally after cloning the repository.

### 1. Configure AWS Credentials

The backend needs AWS credentials to communicate with Textract.

-   **Recommended Method**: Use the AWS CLI. If you haven't already, install it and run the following command, then follow the prompts:
    ```bash
    aws configure
    ```
-   **Alternative**: You can set these credentials as environment variables (see Step 2).

You must also ensure your AWS user or role has the necessary permissions. For development, attaching the `AmazonTextractFullAccess` policy to your IAM user is a quick way to get started.

### 2. Set Up Environment Variables

This project uses `.env` files to manage environment-specific variables like API keys and URLs. You will need to create two `.env` files.

**A. Backend Environment (`ocr-backend/.env`)**

1.  Navigate to the `ocr-backend` directory.
2.  Create a new file named `.env`.
3.  Add the following content. If you ran `aws configure`, you can leave the AWS variables blank, as `boto3` will find them automatically.

    ```
    # If you did not use 'aws configure', provide your credentials here.
    # Otherwise, you can leave these blank.
    AWS_ACCESS_KEY_ID=
    AWS_SECRET_ACCESS_KEY=
    
    # Specify the AWS region where you want to use Textract.
    AWS_DEFAULT_REGION=us-east-1
    ```

**B. Frontend Environment (`ocr-frontend/.env`)**

1.  Navigate to the `ocr-frontend` directory.
2.  Create a new file named `.env`.
3.  Add the following line. This tells your React app where to find the backend API.

    ```
    REACT_APP_API_URL=http://127.0.0.1:5001/api/analyze
    ```

### 3. Install Dependencies & Run Backend

1.  Open a terminal and navigate to the `ocr-backend` directory.
2.  **Create a virtual environment** (highly recommended):
    ```bash
    python -m venv venv
    ```
3.  **Activate the virtual environment**:
    -   On Windows: `venv\Scripts\activate`
    -   On macOS/Linux: `source venv/bin/activate`
4.  **Install Python dependencies**:
    ```bash
    pip install -r requirements.txt
    ```
5.  **Run the Flask server**:
    ```bash
    python app.py
    ```
    The backend should now be running on `http://localhost:5001`.

### 4. Install Dependencies & Run Frontend

1.  Open a **new** terminal and navigate to the `ocr-frontend` directory.
2.  **Install Node.js dependencies**:
    ```bash
    npm install
    ```
3.  **Run the React application**:
    ```bash
    npm start
    ```
    Your default browser should automatically open to `http://localhost:3000`, where you can use the application.

## Project Structure

```
.
├── ocr-backend/
│   ├── app.py              # Main Flask application logic
│   ├── requirements.txt    # Python dependencies
│   └── .env                # (You create this) Environment variables
│
└── ocr-frontend/
    ├── public/
    ├── src/
    │   ├── components/     # (Recommended) Reusable components
    │   ├── App.js          # Main application component
    │   ├── App.css         # Main styles
    │   └── index.js        # Entry point for React app
    ├── .env                # (You create this) Frontend environment variables
    └── package.json        # Frontend dependencies and scripts
```