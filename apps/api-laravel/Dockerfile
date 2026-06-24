FROM php:8.4-fpm-alpine

WORKDIR /app

RUN apk add --no-cache \
        bash \
        curl-dev \
        freetype-dev \
        git \
        icu-dev \
        libxml2-dev \
        libjpeg-turbo-dev \
        libpng-dev \
        libpq-dev \
        libzip-dev \
        nginx \
        oniguruma-dev \
        sqlite-dev \
        supervisor \
        unzip \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install \
        bcmath \
        curl \
        dom \
        gd \
        intl \
        mbstring \
        opcache \
        pcntl \
        pdo_pgsql \
        pdo_sqlite \
        simplexml \
        xml \
        xmlwriter \
        zip

# Raise PHP upload limits so the larger uploads MediaController allows (images
# 8MB, audio 25MB, video 50MB) are not silently rejected by PHP's 2M/8M
# defaults. post_max_size must exceed the largest upload_max_filesize plus form
# overhead. Keep this >= the nginx client_max_body_size at the edge.
RUN { \
        echo 'upload_max_filesize=64M'; \
        echo 'post_max_size=66M'; \
        echo 'memory_limit=256M'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader

COPY . .

# Cache config + routes for production, then make sure storage is linked. Each
# guarded with `|| true` so a build without a full env (e.g. APP_KEY) still
# produces an image (the entrypoint re-caches at boot with the real env).
RUN php artisan config:cache || true \
    && php artisan route:cache || true \
    && php artisan storage:link || true

# nginx fronts php-fpm inside the container and listens on 8000 (the upstream
# the edge nginx / compose proxies to), replacing the single-threaded
# `php artisan serve` dev server which must never serve production traffic.
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8000

# The entrypoint runs `php artisan config:clear` before exec'ing the command so
# the cached config baked at build time (env-defaults, since .env is
# .dockerignore'd) never shadows the runtime `environment:` from compose. It
# exec's whatever CMD/`command:` the service sets, so api (supervisord),
# worker (queue:work) and scheduler (schedule:work) all get the same fix.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Supervisor runs php-fpm and nginx together; if either dies the container exits
# and the orchestrator restarts it.
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
