<?php

namespace Tests\Unit;

use App\Mail\LinkfitTransactionalMail;
use App\Services\Mail\TransactionalMailService;
use Illuminate\Support\Facades\Mail;
use ReflectionProperty;
use Tests\TestCase;

class TransactionalMailServiceTest extends TestCase
{
    public function test_auth_emails_use_locale_aware_web_links(): void
    {
        Mail::fake();
        config()->set('services.linkfit.web_url', 'https://linkfit.az');
        config()->set('services.linkfit.web_locale', 'az');

        $mail = app(TransactionalMailService::class);
        $mail->emailVerification('player@example.com', 'Player', 'verify-token');
        $mail->passwordReset('player@example.com', 'Player', 'reset-token');

        Mail::assertSent(LinkfitTransactionalMail::class, function (LinkfitTransactionalMail $message): bool {
            return str_contains($this->htmlBody($message), 'https://linkfit.az/az/verify-email?token=verify-token');
        });
        Mail::assertSent(LinkfitTransactionalMail::class, function (LinkfitTransactionalMail $message): bool {
            return str_contains($this->htmlBody($message), 'https://linkfit.az/az/reset-password?token=reset-token');
        });
    }

    private function htmlBody(LinkfitTransactionalMail $message): string
    {
        $property = new ReflectionProperty($message, 'htmlBody');
        $property->setAccessible(true);

        return (string) $property->getValue($message);
    }
}
