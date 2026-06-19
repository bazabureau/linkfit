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
        config()->set('services.linkfit.logo_url', 'https://linkfit.az/brand/logolinkfit-dark.png');

        $mail = app(TransactionalMailService::class);
        $mail->emailVerification('player@example.com', 'Player', 'verify-token');
        $mail->passwordReset('player@example.com', 'Player', '123456');

        Mail::assertSent(LinkfitTransactionalMail::class, function (LinkfitTransactionalMail $message): bool {
            $html = $this->htmlBody($message);

            return str_contains($html, 'https://linkfit.az/brand/logolinkfit-dark.png')
                && str_contains($html, 'https://linkfit.az/az/verify-email?token=verify-token');
        });
        Mail::assertSent(LinkfitTransactionalMail::class, function (LinkfitTransactionalMail $message): bool {
            $html = $this->htmlBody($message);

            return str_contains($html, 'https://linkfit.az/brand/logolinkfit-dark.png')
                && str_contains($html, '123456')
                && str_contains($html, 'https://linkfit.az/az/reset-password?step=code&amp;email=player%40example.com');
        });
    }

    private function htmlBody(LinkfitTransactionalMail $message): string
    {
        $property = new ReflectionProperty($message, 'htmlBody');
        $property->setAccessible(true);

        return (string) $property->getValue($message);
    }
}
