<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class LinkfitTransactionalMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    public function __construct(
        private readonly string $mailSubject,
        private readonly string $htmlBody,
    ) {}

    public function build(): self
    {
        return $this
            ->subject($this->mailSubject)
            ->html($this->htmlBody);
    }
}
