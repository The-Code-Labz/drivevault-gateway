FROM node:22-slim

WORKDIR /app

# Install build tools for native deps if needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy backend.
COPY backend/package*.json ./backend/
RUN cd backend && npm install
COPY backend ./backend
RUN cd backend && npm run build

# Copy and build frontend.
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend ./frontend
ARG VITE_API_BASE_URL=
ARG VITE_API_KEY=
RUN cd frontend && npm run build

ENV NODE_ENV=production
ENV PORT=4050

EXPOSE 4050

CMD ["node", "backend/dist/index.js"]
