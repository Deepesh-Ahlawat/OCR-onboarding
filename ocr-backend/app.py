"""
Production-grade Flask application for document analysis using AWS Textract.

This application provides a REST API endpoint for processing document images
and extracting structured data (forms and tables) using Amazon Textract.
"""

import logging
import os
import sys
from typing import Dict, Any, Tuple
import mimetypes
import json
import uuid
from dotenv import load_dotenv
import openai
import base64
from io import BytesIO
from PIL import Image

import boto3
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from botocore.exceptions import ClientError, NoCredentialsError
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

# Configure logging
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# --- Configuration ---
class Config:
    """Application configuration settings."""
    
    # File upload settings
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB - Textract limit
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'pdf'}
    ALLOWED_MIME_TYPES = {
        'image/png', 'image/jpeg', 'image/jpg', 'application/pdf'
    }
    
    # AWS settings
    AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
    
    # Flask settings
    DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    PORT = int(os.getenv('PORT', 5001))
    
    # CORS settings
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:3000').split(',')
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# --- Application Factory ---
def create_app(config_class=Config) -> Flask:
    """
    Create and configure the Flask application.
    
    Args:
        config_class: Configuration class to use
        
    Returns:
        Configured Flask application instance
    """
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = config_class.MAX_FILE_SIZE
    
    # Configure CORS
    CORS(app, origins=config_class.CORS_ORIGINS)
    
    # Register error handlers
    register_error_handlers(app)
    
    # Register routes
    register_routes(app, config_class)

    if not config_class.OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY environment variable not set. Header analysis will fail.")
    else:
        openai.api_key = config_class.OPENAI_API_KEY
        logger.info("OpenAI client initialized successfully.")
    
    logger.info("Application created and configured successfully")
    return app

# --- Utility Functions ---
def is_allowed_file(filename: str, file_content_type: str, config: Config) -> bool:
    """
    Check if the uploaded file is allowed based on extension and MIME type.
    
    Args:
        filename: Name of the uploaded file
        file_content_type: MIME type of the file
        config: Application configuration
        
    Returns:
        True if file is allowed, False otherwise
    """
    if not filename:
        return False
        
    # Check file extension
    file_extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    extension_allowed = file_extension in config.ALLOWED_EXTENSIONS
    
    # Check MIME type
    mime_allowed = file_content_type in config.ALLOWED_MIME_TYPES
    
    return extension_allowed and mime_allowed

def validate_file_upload(request, config: Config) -> Tuple[bool, str, Any]:
    """
    Validate the uploaded file from the request.
    
    Args:
        request: Flask request object
        config: Application configuration
        
    Returns:
        Tuple of (is_valid, error_message, file_object)
    """
    # Check if file part exists in request
    if 'file' not in request.files:
        return False, "No file part in the request", None
    
    file = request.files['file']
    
    # Check if filename is empty
    if not file.filename:
        return False, "No file selected", None
    
    # Secure the filename
    filename = secure_filename(file.filename)
    if not filename:
        return False, "Invalid filename", None
    
    # Check file type
    if not is_allowed_file(filename, file.content_type, config):
        allowed_types = ', '.join(config.ALLOWED_EXTENSIONS)
        return False, f"File type not allowed. Supported types: {allowed_types}", None
    
    return True, "", file

def get_textract_client(region: str = None):
    """
    Get a configured Textract client.
    
    Args:
        region: AWS region to use
        
    Returns:
        Boto3 Textract client
        
    Raises:
        NoCredentialsError: If AWS credentials are not configured
    """
    try:
        return boto3.client('textract', region_name=region)
    except NoCredentialsError as e:
        logger.error("AWS credentials not found")
        raise e

def analyze_document_with_textract(image_bytes: bytes, region: str) -> Dict[str, Any]:
    """
    Analyze document using AWS Textract.
    
    Args:
        image_bytes: Image data as bytes
        region: AWS region for Textract client
        
    Returns:
        Textract analysis response
        
    Raises:
        ClientError: If AWS API call fails
        NoCredentialsError: If credentials are invalid
    """
    textract_client = get_textract_client(region)
    
    logger.info("Starting Textract document analysis")
    response = textract_client.analyze_document(
        Document={'Bytes': image_bytes},
        FeatureTypes=['FORMS', 'TABLES']
    )
    logger.info("Textract analysis completed successfully")
    
    return response

def get_headers_from_openai_vision(prompt_text: str, image_base64: str) -> str:
    """
    Sends a multi-modal prompt (text + image) to the OpenAI Vision API.
    """
    try:
        logger.info(f"Sending multi-modal prompt to OpenAI Vision API. Text length: {len(prompt_text)}")
        
        client = openai.OpenAI()
        
        completion = client.chat.completions.create(
            # IMPORTANT: Use a model that supports vision, like gpt-4-vision-preview
            model="gpt-4.1-mini",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            },
                        },
                    ],
                }
            ],
            # max_tokens is important for vision models to ensure a complete response
            max_tokens=4096 
        )
        
        content = completion.choices[0].message.content
        logger.info("Successfully received response from OpenAI Vision.")
        
        # The response from vision models can sometimes be wrapped in markdown ```json ... ```
        # This code snippet cleans it up.
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()

        return content
        
    except Exception as e:
        logger.error(f"An unexpected error occurred while calling OpenAI Vision: {e}", exc_info=True)
        raise

# --- Route Handlers ---
def register_routes(app: Flask, config: Config):
    """Register application routes."""
    
    @app.route('/health', methods=['GET'])
    def health_check() -> Response:
        """Health check endpoint for monitoring."""
        return jsonify({
            "status": "healthy",
            "service": "textract-document-analyzer",
            "version": "1.0.0"
        })
    
    @app.route('/api/analyze', methods=['POST'])
    def analyze_document() -> Response:
        """
        Analyze document endpoint.
        
        Accepts image uploads and returns structured data extracted by Textract.
        
        Returns:
            JSON response containing extracted document data or error information
        """
        try:
            # Validate file upload
            is_valid, error_message, file = validate_file_upload(request, config)
            if not is_valid:
                logger.warning(f"File validation failed: {error_message}")
                return jsonify({
                    "type": "Validation Error",
                    "error": error_message
                }), 400
            
            # Read file content
            try:
                image_bytes = file.read()
                if not image_bytes:
                    return jsonify({
                        "type": "File Error",
                        "error": "Empty file uploaded"
                    }), 400
                    
                logger.info(f"Processing file: {file.filename} ({len(image_bytes)} bytes)")
                
            except Exception as e:
                logger.error(f"Failed to read uploaded file: {str(e)}")
                return jsonify({
                    "type": "File Error",
                    "error": "Failed to read uploaded file"
                }), 400
            
            # Analyze document with Textract
            try:
                response = analyze_document_with_textract(image_bytes, config.AWS_REGION)
                logger.info("Document analysis completed successfully")
                return jsonify(response)
                
            except ClientError as e:
                error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                error_message = e.response.get('Error', {}).get('Message', str(e))
                logger.error(f"AWS Textract error ({error_code}): {error_message}")
                
                if error_code == 'InvalidParameterException':
                    return jsonify({
                        "type": "AWS Error",
                        "error": "Invalid document format or corrupted file"
                    }), 400
                elif error_code == 'DocumentTooLargeException':
                    return jsonify({
                        "type": "AWS Error", 
                        "error": "Document size exceeds the maximum allowed limit"
                    }), 400
                else:
                    return jsonify({
                        "type": "AWS Error",
                        "error": f"Textract service error: {error_message}"
                    }), 500
                    
            except NoCredentialsError:
                logger.error("AWS credentials not configured")
                return jsonify({
                    "type": "Configuration Error",
                    "error": "AWS credentials not configured. Please check your AWS setup."
                }), 500
                
        except RequestEntityTooLarge:
            logger.warning("File too large uploaded")
            return jsonify({
                "type": "File Error",
                "error": f"File too large. Maximum size allowed: {config.MAX_FILE_SIZE // (1024*1024)}MB"
            }), 413
            
        except Exception as e:
            logger.error(f"Unexpected error in analyze_document: {str(e)}", exc_info=True)
            return jsonify({
                "type": "Server Error",
                "error": "An unexpected error occurred. Please try again."
            }), 500
        
    @app.route('/api/analyze-vision-context', methods=['POST'])
    def analyze_document_vision() -> Response:
        """
        Orchestrates a multi-step document analysis:
        1. Validates file upload.
        2. Analyzes with AWS Textract.
        3. Prepares data for Vision AI.
        4. Analyzes with OpenAI GPT-4 Vision.
        5. Returns both results.
        """
        is_valid, error_message, file = validate_file_upload(request, config)
        if not is_valid:
            return jsonify({"error": error_message}), 400

        try:
            simplified_cells_str = request.form.get('simplified_cells')
            if not simplified_cells_str:
                return jsonify({"error": "Missing 'simplified_cells' data in the request."}), 400
            # --- 1. Read image and prepare for both services ---
            image_bytes = file.read()
            if not image_bytes:
                return jsonify({"error": "Empty file uploaded"}), 400

            # Convert image to Base64 for the AI prompt
            image = Image.open(BytesIO(image_bytes))
            # Ensure image is in a web-friendly format and not too large
            if image.mode == 'PNG':
                image = image.convert('RGB') # Convert RGBA/P to RGB
            
            buffered = BytesIO()
            image.save(buffered, format="JPEG", quality=85) # Compress slightly
            image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

            # Create the text part of the multi-modal prompt
            vision_prompt_text = f"""
            You are an expert document analyst. I am providing you with an image of a document and a JSON array of cell data that was extracted by an OCR service. The JSON contains the cell's text and a unique 'cellId'.

            Your task is to analyze the IMAGE to determine the correct row and column heading (even subheadings) for each cell listed in the JSON array.

            Your task is to return the **exact same JSON structure**, but with one addition: you must add a new key named `headers`.

            The `headers` object must contain two keys:
            1.  `row`: A string containing the full, hierarchical row header. Combine parent and child headers with " > ".
            2.  `col`: A string containing the full, hierarchical column header. Combine parent and child headers in the same way.

            **Do not add, remove, or modify any other keys or values in the original cell objects.** Simply add the `headers` object to each one.

            Here is the JSON input:
            {simplified_cells_str}
            """

            # --- 4. Run OpenAI Vision Analysis ---
            ai_header_analysis = get_headers_from_openai_vision(vision_prompt_text, image_base64)

            # --- 5. Return the combined response ---
            return jsonify({
                "aiHeaderAnalysis": ai_header_analysis
            })

        except Exception as e:
            logger.error(f"An error occurred during the vision analysis pipeline: {e}", exc_info=True)
            return jsonify({"error": "An internal server error occurred during analysis."}), 500

# --- Error Handlers ---
def register_error_handlers(app: Flask):
    """Register global error handlers."""
    
    @app.errorhandler(404)
    def not_found_error(error):
        logger.warning(f"404 error: {request.url}")
        return jsonify({
            "type": "Not Found",
            "error": "The requested endpoint was not found"
        }), 404
    
    @app.errorhandler(405)
    def method_not_allowed_error(error):
        logger.warning(f"405 error: {request.method} {request.url}")
        return jsonify({
            "type": "Method Not Allowed",
            "error": f"Method {request.method} is not allowed for this endpoint"
        }), 405
    
    @app.errorhandler(500)
    def internal_error(error):
        logger.error(f"500 error: {str(error)}", exc_info=True)
        return jsonify({
            "type": "Server Error",
            "error": "Internal server error occurred"
        }), 500

# --- Application Entry Point ---
def main():
    """Main application entry point."""
    config = Config()
    app = create_app(config)
    
    logger.info(f"Starting application on port {config.PORT} (debug={config.DEBUG})")
    app.run(
        host='0.0.0.0',
        port=config.PORT,
        debug=config.DEBUG,
        threaded=True
    )

if __name__ == '__main__':
    main()