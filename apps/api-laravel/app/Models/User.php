<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Maps to the EXISTING `users` table imported from legacy SQL migration
 * 1700000001000. We do not own the schema — Eloquent reads/writes the
 * columns that already exist. `password_hash` is argon2id (PHP's
 * password_verify reads it natively).
 */
class User extends Model
{
    use HasFactory;
    use HasUuids;

    protected $table = 'users';

    public $timestamps = true;

    /**
     * Only user-writeable columns are mass-assignable. Admin/privilege
     * columns (admin_role, is_vip, is_verified, is_ambassador, suspension_*,
     * venue_id, vip_*) are intentionally omitted so they can never be set
     * via fill()/create(). Production writes use explicit property
     * assignment + save(), which is unaffected by this whitelist.
     */
    protected $fillable = [
        'email',
        'phone',
        'username',
        'display_name',
        'photo_url',
        'home_lat',
        'home_lng',
        'password_hash',
        'birth_date',
        'terms_accepted_at',
        'email_verified_at',
    ];

    protected $hidden = ['password_hash'];

    protected $casts = [
        'home_lat' => 'float',
        'home_lng' => 'float',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'deleted_at' => 'datetime',
        'email_verified_at' => 'datetime',
        'is_vip' => 'boolean',
        'vip_expires_at' => 'datetime',
    ];

    /**
     * The `PublicUser` wire shape the iOS client decodes. Field names and
     * nullability MUST match the public user response exactly.
     */
    public function toPublicUser(): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'phone' => $this->phone ?? null,
            'username' => $this->username ?? null,
            'display_name' => $this->display_name,
            'photo_url' => $this->photo_url,
            'home_lat' => $this->home_lat !== null ? (float) $this->home_lat : null,
            'home_lng' => $this->home_lng !== null ? (float) $this->home_lng : null,
            'created_at' => optional($this->created_at)->toIso8601ZuluString('millisecond'),
            'email_verified_at' => optional($this->email_verified_at)->toIso8601ZuluString('millisecond'),
            'is_vip' => (bool) ($this->is_vip ?? false),
            'is_verified' => (bool) ($this->is_verified ?? false),
            'is_ambassador' => (bool) ($this->is_ambassador ?? false),
            'vip_badge_label' => $this->vip_badge_label,
            'vip_expires_at' => optional($this->vip_expires_at)->toIso8601ZuluString('millisecond'),
            'admin_role' => $this->admin_role ?? null,
            'venue_id' => $this->venue_id ?? null,
        ];
    }
}
