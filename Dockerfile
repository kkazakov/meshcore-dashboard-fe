FROM alpine:3.19

ARG API_ENDPOINT
ARG WS_ENDPOINT
RUN apk add --no-cache nginx

COPY . /var/www/html

RUN sed -i "s|const API_BASE = 'http://127.0.0.1:8000';|const API_BASE = '${API_ENDPOINT}';|g" /var/www/html/app.js && \
    sed -i "s|const WS_BASE = 'ws://127.0.0.1:8000';|const WS_BASE = '${WS_ENDPOINT}';|g" /var/www/html/app.js

RUN printf 'server {\n    listen 80;\n    root /var/www/html;\n    index index.html;\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n}\n' > /etc/nginx/http.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
