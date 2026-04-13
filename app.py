import fitz  # pymupdf
from fastapi import FastAPI, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import base64
import json
import requests
import gc
import os

app = FastAPI()

OCR_URL = os.getenv("OCR_URL", "http://ocr-service:8000/v1/chat/completions")

# Default values
DEFAULT_TEMPERATURE = float(os.getenv("OCR_TEMPERATURE", "0.2"))
DEFAULT_MAX_TOKENS = int(os.getenv("OCR_MAX_TOKENS", "2048"))
DEFAULT_TOP_P = float(os.getenv("OCR_TOP_P", "0.9"))

def process_pdf_pages(pdf_bytes):
    """Generator: yield one page at a time to avoid loading all into RAM."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            pix = page.get_pixmap()
            img_bytes = pix.tobytes("png")
            
            # Clear pixmap to free memory immediately
            pix = None
            
            yield page_num, img_bytes
            
            # Free image bytes after yielding
            img_bytes = None
            gc.collect()
    finally:
        doc.close()


def call_ocr(image_bytes, temperature: float = None, max_tokens: int = None):
    """Call OCR service and clear memory after encoding."""
    b64 = base64.b64encode(image_bytes).decode()
    
    # Clear original bytes - we have b64 now
    image_bytes = None

    payload = {
        "model": "lightonai/LightOnOCR-2-1B",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Convert this document to markdown"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"}
                    }
                ]
            }
        ],
        "temperature": temperature if temperature is not None else DEFAULT_TEMPERATURE,
        "max_tokens": max_tokens if max_tokens is not None else DEFAULT_MAX_TOKENS,
        "top_p": DEFAULT_TOP_P
    }

    res = requests.post(OCR_URL, json=payload, timeout=120)
    
    # Clear payload to free b64 string
    b64 = None
    payload = None
    
    return res.json()


def stream_results(content, is_pdf: bool, temperature: float = None, max_tokens: int = None):
    """Stream OCR results as NDJSON (newline-delimited JSON)."""
    yield '{"status": "processing"}\n'
    
    page_count = 0
    
    if is_pdf:
        for page_num, img_bytes in process_pdf_pages(content):
            try:
                ocr_result = call_ocr(img_bytes, temperature, max_tokens)
                result = {"page": page_num + 1, "result": ocr_result}
                yield json.dumps(result) + "\n"
                page_count += 1
            except Exception as e:
                yield json.dumps({"page": page_num + 1, "error": str(e)}) + "\n"
            finally:
                img_bytes = None
                gc.collect()
    else:
        # Single image
        try:
            ocr_result = call_ocr(content, temperature, max_tokens)
            yield json.dumps({"page": 1, "result": ocr_result}) + "\n"
            page_count = 1
        except Exception as e:
            yield json.dumps({"page": 1, "error": str(e)}) + "\n"
    
    # Clear content
    content = None
    gc.collect()
    
    yield json.dumps({"status": "done", "total_pages": page_count}) + "\n"


@app.post("/process")
async def process(
    file: UploadFile = File(...),
    temperature: Optional[float] = Query(default=None, ge=0.0, le=2.0, description="Sampling temperature (0.0-2.0)"),
    max_tokens: Optional[int] = Query(default=None, ge=1, le=32768, description="Max output tokens")
):
    """Process PDF/image with streaming response to handle large files."""
    content = await file.read()
    is_pdf = file.filename.lower().endswith(".pdf")
    
    return StreamingResponse(
        stream_results(content, is_pdf, temperature, max_tokens),
        media_type="application/x-ndjson"
    )


@app.post("/process/sync")
async def process_sync(
    file: UploadFile = File(...),
    temperature: Optional[float] = Query(default=None, ge=0.0, le=2.0, description="Sampling temperature (0.0-2.0)"),
    max_tokens: Optional[int] = Query(default=None, ge=1, le=32768, description="Max output tokens")
):
    """Synchronous version - returns all results at once (for small files)."""
    content = await file.read()
    is_pdf = file.filename.lower().endswith(".pdf")
    
    results = []
    
    if is_pdf:
        for page_num, img_bytes in process_pdf_pages(content):
            try:
                ocr_result = call_ocr(img_bytes, temperature, max_tokens)
                results.append({"page": page_num + 1, "result": ocr_result})
            except Exception as e:
                results.append({"page": page_num + 1, "error": str(e)})
            finally:
                img_bytes = None
                gc.collect()
    else:
        ocr_result = call_ocr(content, temperature, max_tokens)
        results.append({"page": 1, "result": ocr_result})
    
    return {
        "pages": len(results),
        "results": results
    }