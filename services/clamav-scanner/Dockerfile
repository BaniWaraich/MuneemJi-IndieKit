FROM clamav/clamav:stable

# Node 20 + supervisord on top of the official ClamAV image.
# clamd + freshclam are managed by the base image's entrypoint scripts; we
# replace it with supervisord so the Node wrapper runs in the same container.
RUN apk add --no-cache nodejs npm supervisor tini ca-certificates

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY supervisord.conf /etc/supervisord.conf

# Railway-mounted volume target. Signature DB lives here.
VOLUME ["/var/lib/clamav"]

# Wrapper HTTP port. clamd stays on 3310 (localhost only).
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
