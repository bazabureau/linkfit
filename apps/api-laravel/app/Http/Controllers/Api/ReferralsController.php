<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReferralsController extends ApiController
{
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public function redeem(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, ['code' => ['required', 'regex:/^[A-HJ-NP-Z2-9]{6}$/']]);
        $code = strtoupper($data['code']);
        $referrer = DB::table('users')->where('referral_code', $code)->whereNull('deleted_at')->first();
        if ($referrer === null) {
            throw ApiException::notFound('Referral code not found');
        }
        if ($referrer->id === $user->id) {
            throw ApiException::validation('Cannot redeem your own referral code');
        }
        if (DB::table('referrals')->where('referee_user_id', $user->id)->exists()) {
            throw ApiException::conflict('Referral already redeemed');
        }

        DB::transaction(function () use ($user, $referrer, $code) {
            DB::table('referrals')->insert([
                'referee_user_id' => $user->id,
                'referrer_user_id' => $referrer->id,
                'code_used' => $code,
                'created_at' => now(),
            ]);
            DB::table('users')->where('id', $user->id)->update(['referred_by_user_id' => $referrer->id, 'updated_at' => now()]);
            DB::table('users')->where('id', $referrer->id)->increment('referral_count');
        });

        return response()->json([
            'referrer_user_id' => $referrer->id,
            'referrer_display_name' => $referrer->display_name,
            'code_used' => $code,
        ]);
    }

    public function mine(Request $request): JsonResponse
    {
        $user = $this->ensureCode($this->authUser($request));
        $rows = DB::table('referrals as r')
            ->join('users as u', 'u.id', '=', 'r.referee_user_id')
            ->where('r.referrer_user_id', $user->id)
            ->orderByDesc('r.created_at')
            ->get(['u.id', 'u.display_name', 'u.photo_url', 'r.created_at']);

        return response()->json([
            'code' => $user->referral_code,
            'referred_count' => (int) ($user->referral_count ?? $rows->count()),
            'referred_users' => $rows->map(fn ($r) => [
                'id' => $r->id,
                'display_name' => $r->display_name,
                'photo_url' => $r->photo_url,
                'referred_at' => $this->iso($r->created_at),
            ]),
        ]);
    }

    public function card(Request $request): JsonResponse
    {
        $user = $this->ensureCode($this->authUser($request));

        return response()->json([
            'code' => $user->referral_code,
            'count' => (int) ($user->referral_count ?? 0),
            'share_url' => $this->shareUrl($user->referral_code),
        ]);
    }

    public function share(Request $request): JsonResponse
    {
        $user = $this->ensureCode($this->authUser($request));
        $url = $this->shareUrl($user->referral_code);
        $texts = [
            'en' => "Join me on Linkfit: {$url}",
            'az' => "Linkfit-də mənə qoşul: {$url}",
            'ru' => "Присоединяйся ко мне в Linkfit: {$url}",
        ];
        $locale = in_array($request->query('locale'), ['en', 'az', 'ru'], true) ? $request->query('locale') : 'en';

        return response()->json([
            'code' => $user->referral_code,
            'share_url' => $url,
            'share_text' => $texts[$locale],
            'share_text_en' => $texts['en'],
            'share_text_az' => $texts['az'],
            'share_text_ru' => $texts['ru'],
        ]);
    }

    private function ensureCode($user)
    {
        if ($user->referral_code !== null) {
            return $user;
        }
        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
        } while (DB::table('users')->where('referral_code', $code)->exists());
        DB::table('users')->where('id', $user->id)->update(['referral_code' => $code, 'updated_at' => now()]);

        return $user->fresh();
    }

    private function shareUrl(string $code): string
    {
        // Shareable links must point at the public web app (linkfit.az/r/{code}),
        // NOT the API origin (api.linkfit.az is noindexed and has no /r/ route).
        $base = config('app.web_url') ?: 'https://linkfit.az';

        return rtrim((string) $base, '/').'/r/'.$code;
    }
}
