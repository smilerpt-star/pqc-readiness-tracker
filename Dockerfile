# ── Stage 1: Build OpenSSL 3.5 (static binary, no external deps) ─────────────
FROM node:22-bookworm-slim AS openssl-builder

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    wget ca-certificates build-essential perl \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q https://github.com/openssl/openssl/releases/download/openssl-3.5.0/openssl-3.5.0.tar.gz \
    && tar xzf openssl-3.5.0.tar.gz \
    && cd openssl-3.5.0 \
    && ./Configure --prefix=/opt/openssl35 no-shared no-tests \
    && make -j$(nproc) build_programs \
    && make install_programs \
    && cd .. && rm -rf openssl-3.5.0 openssl-3.5.0.tar.gz

# ── Stage 2: App ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS app

# Copy only the static openssl binary from the builder stage
COPY --from=openssl-builder /opt/openssl35/bin/openssl /opt/openssl35/bin/openssl

# Tell the PQC scanner where to find the ML-KEM-capable OpenSSL
ENV PQC_OPENSSL_BIN=/opt/openssl35/bin/openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
