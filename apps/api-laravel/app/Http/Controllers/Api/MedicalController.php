<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MedicalController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        $row = DB::table('medical_profiles')->where('user_id', $this->authUser($request)->id)->first();

        return response()->json($this->profilePayload($row));
    }

    public function update(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'blood_type' => ['sometimes', 'nullable', 'string', 'max:8'],
            'allergies' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'conditions' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'medications' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'emergency_contact_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'emergency_contact_phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'share_medical_with_host' => ['sometimes', 'boolean'],
        ]);
        $values = ['updated_at' => now()];
        foreach (['blood_type', 'allergies', 'conditions', 'medications', 'emergency_contact_name', 'emergency_contact_phone'] as $field) {
            if (array_key_exists($field, $data)) {
                // Normalize blank/whitespace-only input to NULL so the "no value"
                // state is represented consistently (NULL, never an empty string).
                $values[$field] = trim($data[$field] ?? '') ?: null;
            }
        }
        if (array_key_exists('share_medical_with_host', $data)) {
            // Normalize to a strict boolean before persisting: the `boolean`
            // rule validates the input but validated() returns it un-cast, so a
            // string-y "0"/"false" would otherwise be stored as the wrong value
            // (and could silently flip the host-sharing opt-in on).
            $values['share_medical_with_host'] = filter_var($data['share_medical_with_host'], FILTER_VALIDATE_BOOLEAN);
        }

        DB::table('medical_profiles')->updateOrInsert(['user_id' => $user->id], $values);

        return $this->show($request);
    }

    public function gameSummary(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = DB::table('games')->where('id', $id)->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if ((string) $game->host_user_id !== (string) $user->id) {
            throw ApiException::forbidden('Only host can view medical summary');
        }

        $items = DB::table('game_participants as gp')
            ->join('users as u', 'u.id', '=', 'gp.user_id')
            ->join('medical_profiles as m', 'm.user_id', '=', 'gp.user_id')
            ->where('gp.game_id', $id)
            ->where('gp.status', 'confirmed')
            ->where('m.share_medical_with_host', true)
            ->get(['u.id', 'u.display_name', 'm.blood_type', 'm.allergies', 'm.emergency_contact_phone'])
            ->map(fn ($r) => [
                'user_id' => $r->id,
                'display_name' => $r->display_name,
                'blood_type' => $this->bytes($r->blood_type),
                'allergies' => $this->bytes($r->allergies),
                'emergency_contact_phone' => $this->bytes($r->emergency_contact_phone),
            ]);

        return response()->json(['game_id' => $id, 'items' => $items]);
    }

    public function signWaiver(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // Guard before touching tournament_waivers: an unknown tournament id
        // would hit the tournament_id FK (or a uuid-cast error for a non-uuid)
        // and surface as a 500 instead of a clean 404.
        if (! DB::table('tournaments')->where('id', $id)->exists()) {
            throw ApiException::notFound('Tournament not found');
        }
        $already = DB::table('tournament_waivers')->where('tournament_id', $id)->where('user_id', $user->id)->exists();
        DB::table('tournament_waivers')->updateOrInsert(
            ['tournament_id' => $id, 'user_id' => $user->id],
            ['signed_at' => now(), 'ip' => $request->ip(), 'user_agent' => $request->userAgent()],
        );
        $row = DB::table('tournament_waivers')->where('tournament_id', $id)->where('user_id', $user->id)->first();

        return response()->json([
            'tournament_id' => $id,
            'user_id' => $user->id,
            'signed_at' => $this->iso($row->signed_at),
            'already_signed' => $already,
        ]);
    }

    private function profilePayload(?object $row): array
    {
        return [
            'blood_type' => $this->bytes($row->blood_type ?? null),
            'allergies' => $this->bytes($row->allergies ?? null),
            'conditions' => $this->bytes($row->conditions ?? null),
            'medications' => $this->bytes($row->medications ?? null),
            'emergency_contact_name' => $this->bytes($row->emergency_contact_name ?? null),
            'emergency_contact_phone' => $this->bytes($row->emergency_contact_phone ?? null),
            'share_medical_with_host' => (bool) ($row->share_medical_with_host ?? false),
            'updated_at' => $this->iso($row->updated_at ?? null),
        ];
    }

    private function bytes(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_resource($value)) {
            return stream_get_contents($value) ?: null;
        }

        return (string) $value;
    }
}
