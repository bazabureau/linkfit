<?php

namespace Tests\Unit;

use App\Support\ApiException;
use App\Support\ErrorEnvelope;
use Illuminate\Http\Request;
use Tests\TestCase;

class ErrorEnvelopeStatusTest extends TestCase
{
    public function test_validation_errors_use_422_with_existing_wire_code(): void
    {
        $request = Request::create('/api/v1/bookings', 'POST');
        $request->attributes->set('request_id', 'req-test');

        $response = ErrorEnvelope::fromThrowable(ApiException::validation('Request validation failed'), $request);
        $payload = $response->getData(true);

        $this->assertSame(422, $response->getStatusCode());
        $this->assertSame('VALIDATION_ERROR', $payload['error']['code']);
        $this->assertSame('Request validation failed', $payload['error']['message']);
    }
}
