FROM php:8.4-cli-alpine

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
        oniguruma-dev \
        sqlite-dev \
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

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader

COPY . .

RUN php artisan storage:link || true

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
