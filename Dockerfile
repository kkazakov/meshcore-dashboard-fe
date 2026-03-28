FROM node:20-alpine AS builder

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY index.html app.js ./
RUN npm run build:css

FROM alpine:3.19

ARG API_ENDPOINT
ARG WS_ENDPOINT
RUN apk add --no-cache nginx

COPY --from=builder /build/index.html /var/www/html/
COPY --from=builder /build/styles.css /var/www/html/
COPY app.js /var/www/html/

RUN sed -i "s|const API_BASE = 'http://127.0.0.1:8000';|const API_BASE = '${API_ENDPOINT}';|g" /var/www/html/app.js && \
    sed -i "s|const WS_BASE = 'ws://127.0.0.1:8000';|const WS_BASE = '${WS_ENDPOINT}';|g" /var/www/html/app.js

RUN printf 'server {\n    listen 80;\n    root /var/www/html;\n    index index.html;\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n}\n' > /etc/nginx/http.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
