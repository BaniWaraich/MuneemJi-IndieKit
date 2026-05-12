FROM python:3.12-slim

RUN groupadd -g 1500 sandbox && useradd -u 1500 -g 1500 -s /usr/sbin/nologin -M sandbox

WORKDIR /app
COPY requirements.txt .
# Install into the default site-packages so subprocesses launched with env={}
# can still import pdfplumber without relying on PYTHONPATH.
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py /app/server.py
COPY extract-text.py /app/extract-text.py

USER 1500:1500
EXPOSE 8080
CMD ["python", "/app/server.py"]
