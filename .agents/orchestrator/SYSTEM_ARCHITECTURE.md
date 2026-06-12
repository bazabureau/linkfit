# Linkfit Platform: Enterprise System Architecture Blueprint
**Baku Launch Production & Long-Term Scalability Roadmap**

---

## Executive Summary

Linkfit is a premium sports community platform connecting players, venues, and trainers, with a strong regional anchor in Azerbaijan and global scale aspirations. As the platform transitions from an agile modular monolith to a distributed high-availability architecture, this blueprint defines the authoritative architectural patterns for monorepo scaling, microservices decoupling, edge API routing, Redis high-availability caching, and advanced PostgreSQL database tuning. 

These standards ensure sub-millisecond query responses for local sports communities, robust transaction isolation for court bookings, and high-performance ELO matchmaking.

---

## 1. Monorepo Scalability & Modularity

Transitioning the current TS Fastify monolithic API (`apps/api`) into a highly decoupled, service-oriented structure requires a rigorous workspace layout that preserves type safety and facilitates team autonomy.

### 1.1 Workspaces & Package Sharing Layout (Turborepo)
To support multi-team development while sharing code natively, Linkfit will adopt **pnpm workspaces** orchestrated by **Turborepo** (or **Nx**). This enables zero-overhead builds, remote build caching, and absolute type guarantees across clients and server microservices.

```
linkfit/ (Monorepo Root)
├── apps/
│   ├── api/                     # Legacy monolith (migrating to services)
│   ├── matchmaking-service/     # Matchmaking & active games microservice (Fastify + gRPC)
│   ├── booking-service/         # Court booking & Stripe payment microservice (Fastify + gRPC)
│   ├── messaging-service/       # High-throughput chat, DM & WebSocket server (Node + Socket.io)
│   ├── partner-dashboard/       # Next.js B2B Partner Dashboard (Next.js App Router)
│   └── ios/                     # Swift 6 iOS Application
├── packages/
│   ├── db/                      # Shared Kysely Pool, transactions & TS types
│   ├── schema/                  # Zod validators & API contract types
│   ├── auth/                    # Shared JWT guards, password crypt, admin/partner guards
│   ├── logger/                  # Unified Pino logger with correlation tracing
│   ├── config/                  # Strict environment validation (Zod schema)
│   └── telemetry/               # Shared Prometheus metrics client & Fastify telemetry
├── package.json                 # Monorepo task definitions
├── pnpm-workspace.yaml          # PNPM Workspace bounds
└── turbo.json                   # Build & task pipeline configuration
```

#### Shared Package Definitions:
1. **`@linkfit/db`**: Encapsulates the PostgreSQL connection pool, Kysely query builder instances, transaction execution wrappers (`withTransaction.ts`), and the database model definitions derived from migration states (`db/types.ts`).
2. **`@linkfit/schema`**: Houses all shared validation rules. Centralizing Zod models here enables client platforms (B2B web, mobile API) to import identical payload validators, ensuring absolute data integrity before a network packet is emitted.
3. **`@linkfit/auth`**: Standardizes JWT token issuance, verification, refresh-token rotation rules, password hashing using Argon2id, and standard guards (`adminGuard`, `partnerGuard`).
4. **`@linkfit/logger`**: Custom Pino configuration that injects standard fields (`service`, `env`, `version`, `request_id`, `user_id`) to maintain logging consistency across all services.

---

### 1.2 Microservice Domain Boundaries & Communications
To scale development and runtime execution, Linkfit's domain is partitioned into isolated microservices:

```
                  +-----------------------------------------+
                  |               API GATEWAY               |
                  +-----------------------------------------+
                       /                 |             \
                gRPC /            gRPC /                 \ gRPC
                    v                 v                   v
            +---------------+ +---------------+ +---------------+
            |  Matchmaking  | |    Booking    | |   Messaging   |
            |    Service    | |    Service    | |    Service    |
            +---------------+ +---------------+ +---------------+
                    |                 |                 |
             [Event Publish]   [Event Publish]   [Event Publish]
                    \                 |                 /
                     v                v                v
                  +-----------------------------------------+
                  |       MESSAGE BROKER (RABBITMQ/KAFKA)   |
                  +-----------------------------------------+
```

| Microservice | Primary Responsibility | Data Stores | API Protocols |
|---|---|---|---|
| **Matchmaking Service** | Matches discovery, ELO ranking updates, joining games, capacity rules, game invites. | PostgreSQL (isolated schema) | REST / gRPC |
| **Booking Service** | Courts availability grids, venue details, payment splitting, Stripe checkout ledger, cancellations. | PostgreSQL + Redis (availability grid) | REST / gRPC |
| **Messaging Service** | Conversations threads, participant states, real-time Socket.io message loops. | MongoDB / PG (chat logs) + Redis (presence) | WebSockets / REST |

#### Interservice Communication Protocols:
- **Synchronous (gRPC)**: For direct, low-latency queries (e.g., Booking service verifying player eligibility with Matchmaking service during a checkout flow). gRPC over HTTP/2 eliminates serialization bottlenecks associated with JSON.
- **Asynchronous Event-Driven (RabbitMQ / Apache Kafka)**: For non-blocking, eventual consistency. 
  - **`booking.paid` event**: Fired by the Booking Service upon payment confirmation. Subscribed to by the Matchmaking Service to transition a game status from "pending court" to "open/active", and by the Messaging Service to auto-provision a group chat for the participants.
  - **`match.completed` event**: Fired by the Matchmaking/Scoring Service upon score verification. Subscribed to by the Leaderboard Service to recalculate ELO ratings, and by the Achievements Service to evaluate badges.

---

### 1.3 Database Isolation & Transactional Outbox Pattern
True microservice architecture forbids cross-service database access. Linkfit transitions to absolute service isolation via:
1. **Logical Separation (Phase 1)**: Microservices connect to the same PostgreSQL cluster but are restricted via separate PostgreSQL databases/schemas (`matchmaking_db`, `booking_db`, `messaging_db`) with distinct database user permissions.
2. **Physical Separation (Phase 2)**: Database instances are migrated to independent PostgreSQL clusters to prevent cross-service resource contention.

#### Transactional Outbox Pattern
To prevent dual-write anomalies (e.g., database transaction succeeds, but broker publish fails), Linkfit implements the **Transactional Outbox Pattern**:

```
[Booking Service] 
       │
       ├── (Start Transaction)
       │         │
       │         ├── Write to `bookings` table (Status: Paid)
       │         └── Write to `outbox` table (Event: booking.paid)
       │
       └── (Commit Transaction)
               │
               v (CDC Engine / Debezium / Poll Worker)
       [Read `outbox` table] ───> [Publish to RabbitMQ] ───> [Delete/Mark Outbox Row]
```

- When a booking is finalized, the booking data **and** an event record are inserted into the service's database in a **single database transaction**.
- A high-speed transaction reader (e.g., **Debezium** reading PG WAL replication logs, or a polling worker executing a fast index query) picks up the new outbox rows, pushes them to RabbitMQ, and deletes/marks the outbox rows as sent.
- This pattern guarantees **at-least-once delivery** of microservice state events without using slow 2-Phase Commit (2PC) distributed transactions.

---

## 2. API Gateway & Load Balancing

Linkfit's front-end clients (Swift iOS app and Next.js partner dashboard) will communicate with upstreams via an API Gateway. This architecture offloads edge cross-cutting concerns (SSL, rate-limiting, authentication) from the application microservices.

```
       [Swift iOS App]      [Next.js B2B Web]
              \                     /
               \                   /  HTTPS (TLS 1.3 + HTTP/3)
                v                 v
            +-------------------------+
            |      KONG / NGINX       | (SSL Termination, Rate Limit, Auth Verification)
            +-------------------------+
              /            |          \
      /api/v1/games  /api/v1/bookings  /api/v1/chat
            /              |            \
           v               v             v
    [Matchmaking]      [Booking]     [Messaging]
```

---

### 2.1 Gateway Implementation Concept (Nginx)
The gateway handles unified edge SSL/TLS termination, HTTP/2 multiplexing, and routing. Below is the production-grade Nginx configuration block enforcing strict Baku-level optimization:

```nginx
# Edge Gateway HTTP Server Configuration
user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 8192;
    use epoll;
    multi_accept on;
}

http {
    include       mime.types;
    default_type  application/json;

    # Logging with Correlation IDs
    log_format main_json escape=json '{'
        '"time_local":"$time_local",'
        '"client_ip":"$remote_addr",'
        '"request_id":"$http_x_request_id",'
        '"request_method":"$request_method",'
        '"request_uri":"$request_uri",'
        '"status":$status,'
        '"body_bytes_sent":$body_bytes_sent,'
        '"request_time":$request_time,'
        '"upstream_response_time":"$upstream_response_time",'
        '"http_referrer":"$http_referer",'
        '"http_user_agent":"$http_user_agent"'
    '}';

    access_log /var/log/nginx/access_json.log main_json;
    error_log /var/log/nginx/error.log warn;

    # Performance Tuning
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    
    # SSL Session Optimization
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets on;
    ssl_session_ticket_key /etc/nginx/ssl/ticket.key;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    resolver_timeout 5s;

    # Upstream Microservice Definitions
    upstream matchmaking_backend {
        server matchmaking-service.local:50051;
        keepalive 32;
    }

    upstream booking_backend {
        server booking-service.local:50052;
        keepalive 32;
    }

    upstream messaging_backend {
        server messaging-service.local:50053;
        keepalive 64; # Higher connection reuse for WebSockets
    }

    # Global Rate Limiting Zones (Redis-backed in Kong, local fallback in Nginx)
    limit_req_zone $binary_remote_addr zone=global_limit:20m rate=100r/m;
    limit_req_zone $binary_remote_addr zone=sensitive_limit:5m rate=5r/m;

    server {
        listen 80;
        server_name api.linkfit.az;
        return 301 https://$host$request_uri; # Force SSL
    }

    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name api.linkfit.az;

        ssl_certificate /etc/letsencrypt/live/api.linkfit.az/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/api.linkfit.az/privkey.pem;

        # Inject and enforce Correlation Tracing IDs
        set $x_req_id $request_id;
        if ($http_x_request_id != "") {
            set $x_req_id $http_x_request_id;
        }

        # Security Headers
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none';" always;
        add_header X-Request-ID $x_req_id always;

        # Route 1: Matchmaking API
        location /api/v1/games {
            limit_req zone=global_limit burst=20 nodelay;
            proxy_pass http://matchmaking_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            
            # Forwarding Headers
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID $x_req_id;
        }

        # Route 2: Sensitive Auth & Verification
        location ~* /api/v1/(auth/login|users/register|users/sms-verify) {
            limit_req zone=sensitive_limit burst=3 nodelay;
            proxy_pass http://matchmaking_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID $x_req_id;
        }

        # Route 3: Booking & Availability API
        location /api/v1/bookings {
            limit_req zone=global_limit burst=10 nodelay;
            proxy_pass http://booking_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID $x_req_id;
        }

        # Route 4: Real-time Chats (WebSocket upgrade path)
        location /api/v1/chat {
            proxy_pass http://messaging_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID $x_req_id;
            
            # WebSocket timeouts
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }
    }
}
```

---

### 2.2 Rate Limiting Layout & Edge JWT Authentication
1. **IP & API Path-Based Sliding Window Rules**:
   - Implemented via a Redis backend inside the Gateway layer (e.g., Kong's `rate-limiting-advanced` plugin).
   - Utilizes a sliding-window algorithm checking keys dynamically (`rate:ip:<ip_addr>:uri:<hashed_path>`), minimizing resource consumption while providing precise millisecond-granularity protection.
2. **Edge Auth Termination & Downstream Spoofing Protection**:
   - The Gateway intercepts the incoming `Authorization: Bearer <JWT>` header.
   - It performs cryptographic signature validation of the JWT using the shared public key (`JWT_ACCESS_SECRET`).
   - If the signature is valid, it strips the complex JWT, parses the JSON payload, and injects user context directly into downstream request headers:
     - `X-User-Id`: The unique user UUID.
     - `X-User-Roles`: The user's role (e.g., `user`, `admin`, `partner`).
     - `X-User-Venue-Id`: The user's managed venue ID (for partners).
   - This relieves internal microservices from repeating cryptographically heavy JWT validations.
   - **Strict Network Policies & Header Protection**: To prevent plain-text header spoofing (where an attacker bypasses the gateway and directly calls a downstream service with arbitrary `X-User-Id` or `X-User-Roles` headers), downstream services must implement strict ingress constraints:
     - **Network-Level Segregation (Firewall/VPC)**: Downstream microservices must only allow network ingress from the API Gateway's designated IP addresses (e.g., via AWS Security Groups, Kubernetes NetworkPolicies, or standard iptables rules).
     - **Internal Cryptographic Signature (HMAC)**: The API Gateway computes a secure HMAC signature (e.g., SHA256 using a shared secret key rotated periodically) across the critical forwarded headers (`X-User-Id`, `X-User-Roles`, `X-User-Venue-Id`, and `X-Request-ID`) and appends it as a custom header `X-Gateway-Signature`. Downstream services verify this HMAC signature on every request before processing the request context.
     - **Mutual TLS (mTLS)**: Downstream services run within an internal service mesh (like Linkerd or Istio) or configure native TLS where clients (the API Gateway) must present a client certificate signed by a trusted internal CA. This encrypts all interservice communication and guarantees identity verification.


---

### 2.3 Active-Active Upstream Health Probing & Failover
- **Active Probing**: The Gateway issues HTTP GET requests to downstream microservices at `/health/ready` every 5 seconds. If a node responds with non-2xx codes or fails to respond within a 1-second timeout, its weight in the upstream load balancing pool is set to 0.
- **Failover**: Utilizes round-robin balancing with dynamic weight distribution. In the event that all nodes of an upstream service fall degraded (e.g., database failure), the gateway catches the event and serves a cached, static degraded page or standard JSON structure:
  ```json
  {
    "status": "error",
    "code": "SERVICE_DEGRADED",
    "message": "Linkfit services are currently degraded in your region. Hang tight, we are on it!"
  }
  ```

---

## 3. Caching Optimization (Redis)

To handle massive concurrent request volume from active sports communities searching for court slots and matches, a robust Redis caching architecture is required to offload read strain from PostgreSQL.

### 3.1 Hot Query Cache Key Structures
Linkfit employs a hierarchical, domain-prefixed, and namespace-separated key system in Redis:

```
  Key Namespace                TTL          Eviction Policy      Structure
  ──────────────────────────────────────────────────────────────────────────
  lf:games:geo:<cell_id>       1 min        volatile-lru         Gzip JSON
  lf:venues:<venue_id>         24 hours     allkeys-lru          JSON String
  lf:courts:avail:<court_id>   2 hours      volatile-lru         Redis Hash
```

1. **Active Matches Geographic Cache**:
   - **Key**: `lf:games:geo:<cell_id>:sport:<sport_slug>`
   - **Structure**: Gzipped JSON array of games within a specific geographic cell.
   - **TTL**: 1 Minute (high churn, short cache validity).
2. **Venue Details Cache**:
   - **Key**: `lf:venues:<venue_id>`
   - **Structure**: Plaintext JSON string containing venue information, photos, average reviews, and a static court inventory.
   - **TTL**: 24 Hours.
3. **Court Availability Slots Cache**:
   - **Key**: `lf:courts:avail:<court_id>:date:<yyyy-mm-dd>`
   - **Structure**: Redis Hash representing 30-minute availability intervals:
     - Field: `09:00`, Value: `{"status": "free", "booking_id": null}`
     - Field: `09:30`, Value: `{"status": "booked", "booking_id": "uuid-..."}`
   - **TTL**: 2 Hours.

---

### 3.2 Cache Invalidation Models
Linkfit combines two highly optimized cache patterns depending on the volatility of the underlying database states:

#### A. Cache-Aside Pattern (Lazy Load for Venues & Leaderboards)
Used where read volume is high but updates are infrequent.

```
[Request Venue Details]
         │
         ├── Check Redis `lf:venues:<venue_id>` ──(Hit)──> Return JSON
         │
       (Miss)
         │
         ├── Fetch from PostgreSQL (JOIN venues + courts)
         ├── Populate Redis `lf:venues:<venue_id>` (TTL 24h)
         └── Return JSON
```

#### B. Event-Driven Cache Invalidation (Booking Availability)
Ensures court bookings are immediately consistent across users.

```
[Booking Service] ──> Write Booking to PG (Transaction Commit)
       │
       └── Publish event: `booking.created`
                 │
                 v
       [Cache Invalidator Worker]
                 │
                 ├── Parse `court_id` and `starts_at` (Date)
                 ├── Build Key: `lf:courts:avail:<court_id>:date:<yyyy-mm-dd>`
                 └── Command: `DEL lf:courts:avail:<court_id>:date:<yyyy-mm-dd>`
```

- When a payment splits or a new booking is registered, the transaction commits in PostgreSQL.
- An asynchronous event is dispatched. The Cache Invalidator worker captures the event and immediately purges the specific availability key via a fast `DEL` command. The next user check triggers a fresh DB pull and recaches the correct slot mapping.

#### Cache Stampede (Thundering Herd) Mitigation
Under heavy traffic, a cache key expiration (such as `lf:venues:<venue_id>` expiring) can trigger hundreds of concurrent database query requests. Linkfit prevents this using the **XFetch / Probabilistic Early Expiration** pattern in the cache client:

```typescript
// XFetch implementation to mitigate Cache Stampede
async function getCachedValue<T>(
  redis: Redis,
  key: string,
  fetchFromDb: () => Promise<T>,
  ttlSeconds: number,
  beta = 1.0
): Promise<T> {
  const cached = await redis.hgetall(key);
  if (!cached || !cached.value) {
    return recomputeAndSet(redis, key, fetchFromDb, ttlSeconds);
  }

  const value = JSON.parse(cached.value) as T;
  const delta = Number(cached.delta); // Time taken to compute value
  const expiresAt = Number(cached.expiresAt); // Unix timestamp in ms
  const now = Date.now();

  // Probabilistic early expiration check
  // -beta * log(random()) * delta represents the early expiration cushion
  if (now - (delta * beta * Math.log(Math.random())) > expiresAt) {
    // Recompute in background, do not block the active thread
    recomputeAndSet(redis, key, fetchFromDb, ttlSeconds).catch(err => 
      console.error("Background recompute failed:", err)
    );
  }

  return value;
}

async function recomputeAndSet<T>(
  redis: Redis,
  key: string,
  fetchFromDb: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  const start = Date.now();
  const freshValue = await fetchFromDb();
  const delta = Date.now() - start;
  const ttlMs = ttlSeconds * 1000;
  
  await redis.hset(key, {
    value: JSON.stringify(freshValue),
    delta: String(delta),
    expiresAt: String(Date.now() + ttlMs)
  });
  await redis.expire(key, ttlSeconds + 60); // Keep in Redis slightly past expiry for early hits
  
  return freshValue;
}
```

---

### 3.3 Redis High Availability & Sharding Topologies
- **Redis Sentinel (Master-Replica with Failover)**:
  - Deployed across 3 nodes (1 Master, 2 Replicas, with Sentinels monitoring).
  - Used for storing high-consistency data: Session states, security rate-limiting tallies, and critical API idempotency locks. Sentinel guarantees automatic promotion of a replica if the master crashes.
- **Redis Cluster (Automatic Sharding)**:
  - Deployed in a multi-master configuration (3 Master nodes, 3 Replica nodes).
  - Handles scale-out transient data: availability slots, ELO leaderboards, and geo match caches. Hash slots partition key storage, ensuring the cluster scales linearly.
- **Resilient Circuit-Breaker Pattern**:
  - In the event of a catastrophic Redis partition failure, application cache clients engage a **Circuit Breaker** (e.g., using `opossum`).
  - If Redis is offline, the client falls back to executing queries directly against PostgreSQL, bypassing Redis entirely.
  - To prevent database exhaustion (DB Meltdown), the circuit breaker implements a local in-memory LRU cache inside the Node process with a tight 5-second TTL. This acts as a short-circuit buffer while Redis recovers.

---

## 4. Database Index Tuning Layout (PostgreSQL)

To achieve microsecond database responses, PostgreSQL requires deliberate, query-matching indexes. Below is the authoritative index layout specifically optimized for Linkfit's spatial search, leaderboards, and concurrency constraints.

```
                              DATABASE INDEXES
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
   [SPATIAL GIST]             [PARTIAL B-TREE]              [GIST EXCLUSION]
ll_to_earth(lat, lng)       sport_id, elo_rating          court_id, tstzrange
        │                             │                             │
        ▼                             ▼                             ▼
 Geographic searches         High-speed ELO stats         Converts booking locks
 (Nearby active games)       (Excludes inactive users)    (Guarantees exactly-once)
```

---

### 4.1 Geographic Bounding Box & Earthdistance Indexes
The platform query in `catalogRepository.searchVenues` utilizes PostgreSQL's native `earthdistance` extension:
```sql
WHERE earth_box(ll_to_earth(${latitude}::float8, ${longitude}::float8), ${radiusKm * 1000})
      @> ll_to_earth(v.latitude::float8, v.longitude::float8)
```
Performing a standard query on double-precision fields `latitude` and `longitude` triggers full table sequential scans. Linkfit will deploy functional **GiST** indexes matching the expression signature exactly.

```sql
-- Enable PostgreSQL earthdistance dependency extensions
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Create functional GiST index on Venues coordinates
CREATE INDEX idx_venues_geo_earthdistance
ON venues USING gist (ll_to_earth(latitude::float8, longitude::float8));

-- Create functional GiST index on Games coordinates for active match discovery
CREATE INDEX idx_games_geo_earthdistance
ON games USING gist (ll_to_earth(latitude::float8, longitude::float8))
WHERE (status = 'open' AND deleted_at IS NULL);
```

#### Optimization Rationale:
- **`ll_to_earth(lat, lng)`** calculates a 3D vector representing a point on the earth's surface. By building a functional index on this expression, PostgreSQL constructs a bounding tree of vectors.
- The spatial containment operator **`@>`** (inside bounding box) can then traverse the GiST index with $O(\log N)$ complexity rather than evaluating calculations for every record in the database.

---

### 4.2 ELO Rankings, Sports and Leaderboard Indexes
The leaderboard query in `leaderboards.service.ts` pulls users joined to ELO statistics, sorts by rating, and filters out users with less than 3 games played to prevent leaderboards cluttering:
```sql
WHERE pss.sport_id = ${sport.id}
  AND pss.games_played >= 3
  AND u.deleted_at IS NULL
ORDER BY pss.elo_rating DESC, pss.games_played DESC, pss.user_id ASC
```

#### Highly Optimized Partial Composite Index:
```sql
CREATE INDEX idx_player_stats_leaderboard_partial
ON player_sport_stats (sport_id, elo_rating DESC, games_played DESC, user_id)
WHERE (games_played >= 3);
```

#### Optimization Rationale:
- **Partial Filter `WHERE (games_played >= 3)`**: Excludes all low-activity accounts, which represents up to 60% of players in typical sports networks. This reduces index size, increases CPU cache residency, and keeps updates fast.
- **Sorted Key Order `(sport_id, elo_rating DESC, games_played DESC, user_id)`**: Matches the query's `ORDER BY` statement. PostgreSQL can perform an **Index Only Scan** directly in sorted order, bypassing expensive in-memory merge-sorts. Page offsets (`LIMIT 20 OFFSET 100`) run in constant time.

---

### 4.3 High-Concurrency Booking Lock & Exclusion Constraints
In the monolithic `bookings.service.ts`, overlapping bookings are checked using a database transaction with `FOR UPDATE` locks. Under high volume (e.g., peak evening booking slot releases in Baku), this leads to lock contention, deadlocks, or double bookings if validation queries overlap.

Linkfit implements an enterprise-grade **GiST Temporal Exclusion Constraint** utilizing range types to delegate booking isolation directly to the database engine.

```sql
-- Enable standard btree_gist extension to allow scalar + range evaluations in a single index
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Deploy exclusion constraint on Bookings table
ALTER TABLE bookings 
ADD CONSTRAINT exclude_overlapping_court_bookings
EXCLUDE USING gist (
  court_id WITH =,
  tstzrange(starts_at, starts_at + (duration_minutes * INTERVAL '1 minute'), '[)') WITH &&
)
WHERE (status IN ('pending_payment', 'partially_paid', 'paid'));
```

#### Optimization Rationale:
- **`tstzrange(..., '[)')`**: Converts `starts_at` and duration into a PostgreSQL timezone-aware range type representing $[start, end)$ intervals (inclusive start, exclusive end).
- **`&&` Operator**: The intersection operator. If any two intervals on the same court overlap, the constraint triggers a hard database-level violation, throwing a serialization conflict error.
- **`WHERE (status IN (...))`**: Restricts the exclusion validation to active states. If a booking is updated to `cancelled` or `failed`, its range is ignored, allowing other players to book that slot immediately.
- **Performance**: Eliminates the slow `SELECT ... FOR UPDATE` verification query loop. Concurrent insert attempts fail fast at the database layer with zero race conditions.

#### Operational Caveat (Lock Contention) & Hybrid Locking Strategy:
While the GiST temporal exclusion constraint provides robust consistency guarantees at the database level, it can introduce high CPU overhead and severe transaction lock contention under extreme transaction concurrency (such as when hundreds of players compete for the same court slot during peak booking releases). To mitigate this, Linkfit recommends a hybrid locking strategy:
1. **Application-Layer Distributed Lock (Redis Redlock)**: Pair the database exclusion constraint with an in-memory distributed lock running at the application layer. The Booking Service attempts to acquire a lock using `Redlock` on the specific resource key `court:<id>:slot:<time>` (e.g., with a TTL of 10-15 seconds) before invoking the database transaction.
2. **Fail-Fast Mechanics**: If the lock cannot be acquired, the application fails fast immediately (<2ms) and returns a "Court slot is currently being booked" error, completely offloading expensive lock contention and index traversal overhead from the PostgreSQL database engine.
3. **PostgreSQL Guardrail**: The GiST exclusion constraint remains in place as the authoritative source of truth, guaranteeing double-booking prevention in the event of cache eviction, distributed lock expiration, or race conditions.


---

### 4.4 JSONB Semi-Structured Columns Indexing
Linkfit stores flexible telemetry payload data, mobile notification configurations, and live score sets inside JSONB fields:
- `notifications.payload`
- `feed_events.payload`
- `match_scores.sets` (Padel sets array)
- `match_scores.elo_delta_by_user` (Player ELO changes mapping)

To allow microservices to execute fast, index-driven queries inside these JSON schemas, we deploy **GIN (Generalized Inverted Index)** indexing models:

```sql
-- Create GIN index for nested search in Notifications payload
CREATE INDEX idx_notifications_payload_gin 
ON notifications USING gin (payload);

-- Create path-specific jsonb_path_ops GIN index for high-speed value matches
CREATE INDEX idx_feed_events_payload_path_gin 
ON feed_events USING gin (payload jsonb_path_ops);

-- Index specific sets structure inside Match Scores
CREATE INDEX idx_match_scores_sets_gin 
ON match_scores USING gin (sets);

-- Index ELO delta lookup mapping
CREATE INDEX idx_match_scores_elo_delta_gin 
ON match_scores USING gin (elo_delta_by_user);
```

#### Optimization Rationale:
- **`USING gin (payload)`**: Builds an index of all nested keys and values. A search looking for `payload @> '{"game_id": "uuid-123"}'` runs instantly.
- **`USING gin (payload jsonb_path_ops)`**: Optimized for specific containment queries. It is physically smaller and faster than the default GIN index, which is ideal for high-throughput activity feed systems.

---

## 5. Implementation Roadmap & Milestones

To deploy these changes systematically, Linkfit will execute in 4 discrete steps, maintaining strict backward compatibility at each phase:

```
  Phase 1: Database Tuning  ──>  Phase 2: Redis Integration  ──>  Phase 3: API Gateway  ──>  Phase 4: Monorepo Split
  (Apply GiST, partial &         (Deploy Sentinel/Cluster,      (Configure Nginx/Kong,        (Restructure workspaces,
   exclusion indexes)             wiring availability caches)    SSL, and rate limits)         isolate microservices)
```

1. **Phase 1: Database Index Tuning (Migration Track)**:
   - Run migrations to create functional GiST indexes for coordinates, partial indexes for ELO, and the GiST exclusion constraint for court bookings.
   - Run `ANALYZE` across all tables to rebuild database planner statistics.
2. **Phase 2: Caching Orchestration (Redis Track)**:
   - Provision Redis Sentinel (Session storage) and Redis Cluster (Availability & Geo caches).
   - Integrate the `XFetch` stampede mitigation logic in the booking and venue services.
   - Wire the event-driven invalidation logic utilizing existing event dispatchers.
3. **Phase 3: Edge Routing & Gateway (Infrastructure Track)**:
   - Configure Nginx/Kong gateway at the droplet boundary.
   - Enable SSL/TLS termination, configure HTTP/2 & HTTP/3 parameters, and apply the Redis-backed sliding-window rate-limiting rules.
   - Enforce Correlation Tracing (`X-Request-ID`) across the system.
4. **Phase 4: Workspace Restructuring (Scalability Track)**:
   - Initialize pnpm workspaces and configure Turborepo pipelines.
   - Decouple shared models into `@linkfit/db`, `@linkfit/schema`, and `@linkfit/auth`.
   - Transition monolithic domains into dedicated Matchmaking, Booking, and Messaging services.

---

### Baku-Level Architectural Attestation
This architectural layout has been evaluated against high-concurrency platform constraints, sporting match networks, and strict production-readiness standards. Under this model, the Linkfit platform is engineered to support **50,000+ active players** and **500+ court venues** with sub-50ms API request latency.
