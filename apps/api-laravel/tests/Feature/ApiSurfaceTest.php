<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiSurfaceTest extends TestCase
{
    public function test_health_returns_ok(): void
    {
        $this->getJson('/health')
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_app_metadata_reports_laravel_api(): void
    {
        $this->getJson('/api/v1/app/metadata')
            ->assertOk()
            ->assertJsonPath('api', 'laravel');
    }

    public function test_realtime_health_returns_polling_status(): void
    {
        $this->getJson('/api/v1/realtime/health')
            ->assertOk()
            ->assertJsonPath('transport', 'polling');
    }
}
