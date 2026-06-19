<?php

namespace App\Mail;

use Illuminate\Support\Facades\Cache;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\MessageConverter;

/**
 * Sends mail through the Gmail API over HTTPS (gmail.users.messages.send).
 *
 * We use the REST API (port 443) instead of SMTP because the host blocks
 * outbound SMTP ports (25/465/587). Auth is OAuth2: a long-lived refresh token
 * (obtained once via consent) is exchanged for short-lived access tokens, which
 * are cached so we don't refresh on every send.
 */
class GmailApiTransport extends AbstractTransport
{
    public function __construct(
        private readonly string $clientId,
        private readonly string $clientSecret,
        private readonly string $refreshToken,
    ) {
        parent::__construct();
    }

    protected function doSend(SentMessage $message): void
    {
        $email = MessageConverter::toEmail($message->getOriginalMessage());
        // Gmail API wants the full RFC 2822 message, base64url-encoded.
        $raw = rtrim(strtr(base64_encode($email->toString()), '+/', '-_'), '=');

        [$body, $status, $err] = $this->http(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            json_encode(['raw' => $raw]),
            [
                'Authorization: Bearer '.$this->accessToken(),
                'Content-Type: application/json',
            ],
        );

        if ($status < 200 || $status >= 300) {
            throw new \RuntimeException('Gmail API send failed ('.$status.'): '.($err !== '' ? $err : $body));
        }
    }

    private function accessToken(): string
    {
        return Cache::remember('gmail_api_access_token', 3000, function () {
            [$body, $status] = $this->http(
                'https://oauth2.googleapis.com/token',
                http_build_query([
                    'client_id' => $this->clientId,
                    'client_secret' => $this->clientSecret,
                    'refresh_token' => $this->refreshToken,
                    'grant_type' => 'refresh_token',
                ]),
                ['Content-Type: application/x-www-form-urlencoded'],
            );

            $data = json_decode((string) $body, true);
            if ($status < 200 || $status >= 300 || empty($data['access_token'])) {
                throw new \RuntimeException('Gmail OAuth token refresh failed ('.$status.'): '.$body);
            }

            return (string) $data['access_token'];
        });
    }

    /**
     * @param  list<string>  $headers
     * @return array{0:string,1:int,2:string}  [body, httpStatus, curlError]
     */
    private function http(string $url, string $payload, array $headers): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        return [$body === false ? '' : (string) $body, $status, $err];
    }

    public function __toString(): string
    {
        return 'gmail+api://default';
    }
}
