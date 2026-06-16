# Linkfit Backend Packages

The Laravel backend dependencies are declared in `composer.json` and locked in
`composer.lock`.

## Runtime PHP packages

- `laravel/framework` - Laravel API framework.
- `firebase/php-jwt` - HS256 access JWT encode/decode.
- `guzzlehttp/guzzle` - HTTP client used by Laravel `Http` facade for OAuth calls.
- `intervention/image` - image processing package reserved for media/OG image work.
- `laravel/horizon` - Redis queue worker dashboard and queue supervision.
- `predis/predis` - Redis client for cache, queue, locks, and rate-related production use.
- `league/flysystem-aws-s3-v3` - S3-compatible storage adapter for AWS S3, Cloudflare R2, and similar media storage.
- `sentry/sentry-laravel` - production error reporting and optional tracing.
- `spatie/laravel-health` - application health checks for DB, cache, Redis, disk, and Horizon.
- `edamov/pushok` - APNs client for iOS push notifications.
- `laravel/tinker` - production-safe Laravel REPL package.

## Dev packages

- `fakerphp/faker` - test data generation.
- `laravel/pail` - local log tailing.
- `laravel/pao` - agent-friendly PHPUnit output.
- `laravel/pint` - PHP formatting.
- `mockery/mockery` - test doubles.
- `nunomaduro/collision` - CLI exception output.
- `phpunit/phpunit` - test runner.

## Direct Composer packages

These are the packages we explicitly require in `composer.json`.

- `edamov/pushok` `0.19.1`
- `fakerphp/faker` `1.24.1`
- `firebase/php-jwt` `7.1.0`
- `guzzlehttp/guzzle` `7.11.1`
- `intervention/image` `4.1.3`
- `laravel/framework` `13.15.0`
- `laravel/horizon` `5.47.2`
- `laravel/pail` `1.2.7`
- `laravel/pao` `1.1.1`
- `laravel/pint` `1.29.1`
- `laravel/tinker` `3.0.2`
- `league/flysystem-aws-s3-v3` `3.34.0`
- `mockery/mockery` `1.6.12`
- `nunomaduro/collision` `8.9.4`
- `phpunit/phpunit` `12.5.29`
- `predis/predis` `3.5.1`
- `sentry/sentry-laravel` `4.26.0`
- `spatie/laravel-health` `1.40.0`

## Required PHP extensions

- `bcmath`
- `ctype`
- `curl`
- `dom`
- `fileinfo`
- `filter`
- `gd`
- `hash`
- `iconv`
- `intl`
- `json`
- `mbstring`
- `openssl`
- `pcre`
- `pdo`
- `pdo_pgsql`
- `pdo_sqlite`
- `phar`
- `session`
- `simplexml`
- `tokenizer`
- `xml`
- `xmlwriter`
- `zip`

The production Dockerfile installs the buildable extensions needed by the API:
`bcmath`, `curl`, `dom`, `gd`, `intl`, `mbstring`, `opcache`, `pcntl`,
`pdo_pgsql`, `pdo_sqlite`, `simplexml`, `xml`, `xmlwriter`, and `zip`.

The APNs package also requires system libraries `lib-curl` and `lib-openssl`.

## Full Composer installed package list

This is the full `composer show` list from the current lockfile, including
transitive dependencies.

- `aws/aws-crt-php` `1.2.7`
- `aws/aws-sdk-php` `3.384.8`
- `brick/math` `0.14.8`
- `carbonphp/carbon-doctrine-types` `3.2.0`
- `dflydev/dot-access-data` `3.0.3`
- `doctrine/inflector` `2.1.0`
- `doctrine/lexer` `3.0.1`
- `dragonmantank/cron-expression` `3.6.0`
- `edamov/pushok` `0.19.1`
- `egulias/email-validator` `4.0.4`
- `fakerphp/faker` `1.24.1`
- `filp/whoops` `2.18.4`
- `firebase/php-jwt` `7.1.0`
- `fruitcake/php-cors` `1.4.0`
- `graham-campbell/result-type` `1.1.4`
- `guzzlehttp/guzzle` `7.11.1`
- `guzzlehttp/promises` `2.5.0`
- `guzzlehttp/psr7` `2.11.0`
- `guzzlehttp/uri-template` `1.0.6`
- `hamcrest/hamcrest-php` `2.1.1`
- `intervention/gif` `5.0.1`
- `intervention/image` `4.1.3`
- `jean85/pretty-package-versions` `2.1.1`
- `laravel/agent-detector` `2.0.2`
- `laravel/framework` `13.15.0`
- `laravel/horizon` `5.47.2`
- `laravel/pail` `1.2.7`
- `laravel/pao` `1.1.1`
- `laravel/pint` `1.29.1`
- `laravel/prompts` `0.3.18`
- `laravel/sentinel` `1.1.0`
- `laravel/serializable-closure` `2.0.13`
- `laravel/tinker` `3.0.2`
- `league/commonmark` `2.8.2`
- `league/config` `1.2.0`
- `league/flysystem` `3.34.0`
- `league/flysystem-aws-s3-v3` `3.34.0`
- `league/flysystem-local` `3.31.0`
- `league/mime-type-detection` `1.16.0`
- `league/uri` `7.8.1`
- `league/uri-interfaces` `7.8.1`
- `mockery/mockery` `1.6.12`
- `monolog/monolog` `3.10.0`
- `mtdowling/jmespath.php` `2.9.1`
- `myclabs/deep-copy` `1.13.4`
- `nesbot/carbon` `3.11.4`
- `nette/schema` `1.3.5`
- `nette/utils` `4.1.4`
- `nikic/php-parser` `5.7.0`
- `nunomaduro/collision` `8.9.4`
- `nunomaduro/termwind` `2.4.0`
- `nyholm/psr7` `1.8.2`
- `phar-io/manifest` `2.0.4`
- `phar-io/version` `3.2.1`
- `phpoption/phpoption` `1.9.5`
- `phpunit/php-code-coverage` `12.5.7`
- `phpunit/php-file-iterator` `6.0.1`
- `phpunit/php-invoker` `6.0.0`
- `phpunit/php-text-template` `5.0.0`
- `phpunit/php-timer` `8.0.0`
- `phpunit/phpunit` `12.5.29`
- `predis/predis` `3.5.1`
- `psr/clock` `1.0.0`
- `psr/container` `2.0.2`
- `psr/event-dispatcher` `1.0.0`
- `psr/http-client` `1.0.3`
- `psr/http-factory` `1.1.0`
- `psr/http-message` `2.0`
- `psr/log` `3.0.2`
- `psr/simple-cache` `3.0.0`
- `psy/psysh` `0.12.23`
- `ralouphie/getallheaders` `3.0.3`
- `ramsey/collection` `2.1.1`
- `ramsey/uuid` `4.9.2`
- `sebastian/cli-parser` `4.2.1`
- `sebastian/comparator` `7.1.8`
- `sebastian/complexity` `5.0.0`
- `sebastian/diff` `7.0.0`
- `sebastian/environment` `8.1.2`
- `sebastian/exporter` `7.0.3`
- `sebastian/global-state` `8.0.3`
- `sebastian/lines-of-code` `4.0.1`
- `sebastian/object-enumerator` `7.0.0`
- `sebastian/object-reflector` `5.0.0`
- `sebastian/recursion-context` `7.0.1`
- `sebastian/type` `6.0.4`
- `sebastian/version` `6.0.0`
- `sentry/sentry` `4.28.0`
- `sentry/sentry-laravel` `4.26.0`
- `spomky-labs/pki-framework` `1.4.2`
- `spatie/enum` `3.13.0`
- `spatie/laravel-health` `1.40.0`
- `spatie/laravel-package-tools` `1.93.1`
- `spatie/regex` `3.1.1`
- `staabm/side-effects-detector` `1.0.5`
- `symfony/clock` `8.1.0`
- `symfony/console` `8.1.0`
- `symfony/css-selector` `8.1.0`
- `symfony/deprecation-contracts` `3.7.0`
- `symfony/error-handler` `8.1.0`
- `symfony/event-dispatcher` `8.1.0`
- `symfony/event-dispatcher-contracts` `3.7.0`
- `symfony/filesystem` `8.1.0`
- `symfony/finder` `8.1.0`
- `symfony/http-foundation` `8.1.0`
- `symfony/http-kernel` `8.1.0`
- `symfony/mailer` `8.1.0`
- `symfony/mime` `8.1.0`
- `symfony/options-resolver` `8.1.0`
- `symfony/polyfill-ctype` `1.37.0`
- `symfony/polyfill-intl-grapheme` `1.38.1`
- `symfony/polyfill-intl-idn` `1.38.1`
- `symfony/polyfill-intl-normalizer` `1.38.0`
- `symfony/polyfill-mbstring` `1.38.2`
- `symfony/polyfill-php80` `1.37.0`
- `symfony/polyfill-php83` `1.38.2`
- `symfony/polyfill-php84` `1.38.1`
- `symfony/polyfill-php85` `1.38.1`
- `symfony/polyfill-php86` `1.38.0`
- `symfony/polyfill-uuid` `1.37.0`
- `symfony/process` `8.1.0`
- `symfony/psr-http-message-bridge` `8.1.0`
- `symfony/routing` `8.1.0`
- `symfony/service-contracts` `3.7.0`
- `symfony/string` `8.1.0`
- `symfony/translation` `8.1.0`
- `symfony/translation-contracts` `3.7.0`
- `symfony/uid` `8.1.0`
- `symfony/var-dumper` `8.1.0`
- `theseer/tokenizer` `2.0.1`
- `tijsverkoyen/css-to-inline-styles` `2.4.0`
- `vlucas/phpdotenv` `5.6.3`
- `voku/portable-ascii` `2.1.1`
- `web-token/jwt-library` `4.1.7`
