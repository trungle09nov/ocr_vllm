# OCR vLLM Deployment Guide

Repository nay chay 2 service bang Docker Compose:

- `ocr-service` (vLLM OpenAI-compatible API, model LightOnOCR)
- `preprocess-service` (FastAPI xu ly upload PDF/image va stream ket qua)

## 1) Deploy Backend (Docker)

### 1. Clone repo

```bash
git clone <your-repo-url>
cd ocr_vllm
```

### 2. Tao file `.env`

```bash
cp .env.example .env
```

Cap nhat cac bien sau trong `.env`:

- `OCR_GPU_ID` (vi du: `0` de pin vao GPU 0)
- `OCR_GPU_MEMORY_UTILIZATION` (vi du: `0.6` de gioi han VRAM)
- `LOCAL_MODEL_DIR` (duong dan host chua model local)
- `OCR_MODEL` (duong dan model trong container, mac dinh `/models/LightOnOCR-2-1B`)
- `HUGGING_FACE_HUB_TOKEN` (chi can khi khong dung model local)
- `OCR_TEMPERATURE`
- `OCR_MAX_TOKENS`
- `OCR_TOP_P`
- `CORS_ALLOW_ORIGINS` (vi du: `https://your-domain.com` hoac `*`)

### 3. Chay backend

```bash
docker compose up -d
```

### 4. Health check

```bash
curl http://localhost:9000/health
```

Ky vong:

```json
{"status":"ok"}
```

## 2) Deploy Frontend (Nginx)

Gia su frontend la file `index.html`.

### 1. Copy frontend

```bash
sudo mkdir -p /var/www/html/ocr
sudo cp index.html /var/www/html/ocr/
```

### 2. Cau hinh Nginx cho `/ocr/` va proxy `/ocr/api/`

Vi du block Nginx:

```nginx
server {
	listen 80;
	server_name _;

	location /ocr/ {
		alias /var/www/html/ocr/;
		index index.html;
		try_files $uri $uri/ /ocr/index.html;
	}

	# Proxy API de tranh CORS tu browser
	location /ocr/api/ {
		proxy_pass http://127.0.0.1:9000/;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 300s;
		proxy_send_timeout 300s;
		proxy_buffering off;
	}
}
```

Sau do reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 3) CORS Strategy

Da ho tro san CORS middleware trong FastAPI qua bien `CORS_ALLOW_ORIGINS`.

- Cach 1: Bat CORS tai backend (`CORS_ALLOW_ORIGINS=https://your-domain.com`)
- Cach 2: Dung Nginx reverse proxy `/ocr/api/` de frontend goi cung domain/path va tranh CORS

Khuyen nghi production: uu tien reverse proxy va gioi han domain cu the, khong dung `*`.

## 4) Cai tien (Optional)

- Batch upload nhieu file
- History/log moi lan OCR
- Luu ket qua vao database
- Authentication neu mo public

## 5) Kien truc

```text
Browser -> Nginx (/ocr/) -> index.html
				  \
				   -> (/ocr/api/) -> preprocess-service:9000 -> pymupdf tach PDF thanh anh
														 \
														  -> ocr-service:9001 -> vLLM LightOnOCR -> markdown
Browser nhan streaming -> hien thi + export
```