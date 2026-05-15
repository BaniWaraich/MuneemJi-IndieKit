FROM clamav/clamav:stable

# Node 20 + supervisord on top of the official ClamAV image.
# clamd + freshclam are managed by the base image's entrypoint scripts; we
# replace it with supervisord so the Node wrapper runs in the same container.
RUN apk add --no-cache nodejs npm supervisor tini ca-certificates

WORKDIR /app
COPY package.json package-lock.json* ./
# Install all deps (incl. tsc + @types) so the build step works,
# then prune devDependencies for a smaller runtime image.
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

COPY supervisord.conf /etc/supervisord.conf

# Signature DB lives at /var/lib/clamav. Attach a Railway Volume at that
# mount path via the dashboard — Railway rejects Docker VOLUME directives.

# Wrapper HTTP port. clamd stays on 3310 (localhost only).
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
