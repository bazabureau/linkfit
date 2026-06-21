<?php

namespace App\Http\Controllers\Api;

use App\Services\Launch\LaunchConfig;
use Illuminate\Http\JsonResponse;

class AppInfoController extends ApiController
{
    public function version(): JsonResponse
    {
        $latestVersion = config('services.linkfit.latest_version', '1.0.0');
        // Keep this equal to the build currently shipping to users (CURRENT_PROJECT_VERSION,
        // presently 13). If it's HIGHER than the installed build, every user sees a false
        // "Yeni versiya mövcuddur" soft banner pointing at a build that doesn't exist. Bump
        // it only when a newer build is actually live on the App Store / TestFlight.
        $latestBuild = (int) config('services.linkfit.ios_latest_build', 13);
        $minSupportedBuild = (int) config('services.linkfit.ios_min_supported_build', 1);
        $forceUpdate = (bool) config('services.linkfit.ios_force_update', false);
        $releaseNotesUrl = config('services.linkfit.ios_release_notes_url');

        return response()->json([
            // iOS AppVersionResponse decodes this nested `ios` block. Every
            // field except `release_notes_url` is non-optional on the Swift
            // side, so each must be present with the correct JSON type.
            'ios' => [
                'latest_build' => $latestBuild,
                'latest_version' => (string) $latestVersion,
                'min_supported_build' => $minSupportedBuild,
                'force_update' => $forceUpdate,
                'release_notes_url' => $releaseNotesUrl !== null ? (string) $releaseNotesUrl : null,
            ],
            // Legacy flat keys kept additively for any older/web consumers.
            'minimum_supported_version' => config('services.linkfit.minimum_supported_version', '1.0.0'),
            'latest_version' => (string) $latestVersion,
            'force_update' => $forceUpdate,
        ]);
    }

    public function metadata(): JsonResponse
    {
        return response()->json([
            'api' => 'laravel',
            'environment' => app()->environment(),
            'api_key' => $this->apiKeyContract(),
            'features' => [
                'auth' => true,
                'catalog' => true,
                'games' => true,
                'bookings' => true,
            ],
        ]);
    }

    public function capabilities(): JsonResponse
    {
        $launch = app(LaunchConfig::class);
        $showSubscriptionSurface = $this->showSubscriptionSurface();
        $showPaymentSurface = $this->showPaymentSurface();
        $clients = [
            'ios' => [
                'auth' => true,
                'account_security' => true,
                'membership' => true,
                'catalog' => true,
                'catalog_filters' => true,
                'court_availability' => true,
                'booking_quote' => true,
                'booking_create' => true,
                'booking_suggested_slots' => true,
                'promo_codes' => true,
                'booking_history' => true,
                'booking_receipt' => true,
                'booking_export' => true,
                'booking_holds' => true,
                'booking_waitlist' => true,
                'payment_history' => true,
                'booking_reschedule' => true,
                'booking_cancel' => true,
                'booking_cancellation_reason' => true,
                'booking_refund_tracking' => true,
                'games' => true,
                'tournaments' => true,
                'notifications' => true,
                'media_upload' => true,
                'saved_places' => true,
                'activity_timeline' => true,
                'support_tickets' => true,
                'owner_applications' => true,
                'user_reporting' => true,
                'content_reporting' => true,
                'user_blocking' => true,
                'blocked_users_management' => true,
                'account_deletion' => true,
                'account_data_export' => true,
                'content_deletion' => true,
            ],
            'web' => [
                'auth' => true,
                'account_security' => true,
                'membership' => true,
                'catalog' => true,
                'catalog_filters' => true,
                'checkout' => true,
                'dashboard' => true,
                'booking_quote' => true,
                'booking_create' => true,
                'booking_suggested_slots' => true,
                'promo_codes' => true,
                'booking_history' => true,
                'booking_receipt' => true,
                'booking_export' => true,
                'booking_holds' => true,
                'booking_waitlist' => true,
                'payment_history' => true,
                'booking_reschedule' => true,
                'booking_cancel' => true,
                'booking_cancellation_reason' => true,
                'booking_refund_tracking' => true,
                'saved_places' => true,
                'activity_timeline' => true,
                'support_tickets' => true,
                'owner_applications' => true,
                'user_reporting' => true,
                'content_reporting' => true,
                'user_blocking' => true,
                'account_deletion' => true,
                'account_data_export' => true,
                'content_deletion' => true,
            ],
            'owner' => [
                'role_login' => true,
                'account' => true,
                'bootstrap' => true,
                'lookups' => true,
                'dashboard_stats' => true,
                'metrics' => true,
                'booking_calendar' => true,
                'booking_quote' => true,
                'booking_holds' => true,
                'booking_bulk_status' => true,
                'booking_export' => true,
                'booking_waitlist' => true,
                'booking_check_in' => true,
                'booking_refunds' => true,
                'booking_clear_no_show' => true,
                'booking_internal_note' => true,
                'court_schedule' => true,
                'court_availability' => true,
                'customers' => true,
                'user_search' => true,
                'activity' => true,
                'manual_booking' => true,
                'revenue_reports' => true,
                'staff_accounts' => true,
                'staff_permissions' => true,
                'booking_rules' => true,
                'maintenance_blocks' => true,
                'maintenance_block_update' => true,
            ],
            'admin' => [
                'role_login' => true,
                'bootstrap' => true,
                'lookups' => true,
                'stats' => true,
                'metrics' => true,
                'search' => true,
                'activity' => true,
                'staff_accounts' => true,
                'staff_permissions' => true,
                'users' => true,
                'customers' => true,
                'games' => true,
                'bookings' => true,
                'booking_quote' => true,
                'manual_booking' => true,
                'booking_holds' => true,
                'booking_bulk_status' => true,
                'booking_export' => true,
                'booking_waitlist' => true,
                'booking_check_in' => true,
                'booking_refunds' => true,
                'booking_clear_no_show' => true,
                'booking_internal_note' => true,
                'venues' => true,
                'courts' => true,
                'calendar' => true,
                'revenue_reports' => true,
                'partners' => true,
                'operations' => true,
                'media' => true,
                'push_jobs' => true,
                'announcements' => true,
                'notifications' => true,
                'support_tickets' => true,
                'owner_applications' => true,
                'promo_codes' => true,
                'audit_export' => true,
                'moderation_reports' => true,
                'moderation_user_review' => true,
                'moderation_content_delete' => true,
            ],
        ];
        if (! $showSubscriptionSurface) {
            unset($clients['ios']['membership'], $clients['web']['membership']);
        }
        if (! $showPaymentSurface) {
            unset($clients['ios']['payment_history'], $clients['web']['payment_history']);
        }

        $endpoints = [
            'version' => '/api/v1/app/version',
            'metadata' => '/api/v1/app/metadata',
            'register' => '/api/v1/auth/register',
            'login' => '/api/v1/auth/login',
            'refresh' => '/api/v1/auth/refresh',
            'logout' => '/api/v1/auth/logout',
            'admin_login' => '/api/v1/auth/admin/login',
            'owner_login' => '/api/v1/auth/owner/login',
            'sports' => '/api/v1/sports',
            'venues' => '/api/v1/venues',
            'courts' => '/api/v1/courts',
            'venue_availability' => '/api/v1/venues/{id}/availability?date=YYYY-MM-DD',
            'court_availability' => '/api/v1/courts/{id}/availability?date=YYYY-MM-DD',
            'court_suggested_slots' => '/api/v1/courts/{id}/suggested-slots?starts_at=ISO8601&duration_minutes=60',
            'booking_quote' => '/api/v1/bookings/quote',
            'booking_holds' => '/api/v1/booking-holds',
            'promo_code_validate' => '/api/v1/promo-codes/validate',
            'booking_history' => '/api/v1/bookings',
            'booking_export' => '/api/v1/bookings/me/export',
            'booking_waitlist' => '/api/v1/me/waitlist',
            'court_waitlist' => '/api/v1/courts/{id}/waitlist',
            'booking_create' => '/api/v1/bookings',
            'booking_update' => '/api/v1/bookings/{id}',
            'booking_cancel' => '/api/v1/bookings/{id}/cancel',
            'booking_receipt' => '/api/v1/bookings/{id}/receipt',
            'membership_plans' => '/api/v1/membership/plans',
            'me_membership' => '/api/v1/me/membership',
            'membership_subscribe' => '/api/v1/membership/subscribe',
            'membership_portal' => '/api/v1/me/membership/portal',
            'membership_cancel' => '/api/v1/membership/cancel',
            'payment_history' => '/api/v1/payments/history',
            'payment_summary' => '/api/v1/payments/summary',
            'web_bootstrap' => '/api/v1/web/bootstrap',
            'web_checkout' => '/api/v1/web/checkout/courts/{courtId}',
            'web_dashboard' => '/api/v1/web/dashboard',
            'me_change_password' => '/api/v1/me/change-password',
            'me_change_email' => '/api/v1/me/change-email',
            'me_devices' => '/api/v1/me/devices',
            'me_notification_preferences' => '/api/v1/me/notification-preferences',
            'me_activity' => '/api/v1/me/activity',
            'me_delete' => '/api/v1/me/delete',
            'me_delete_status' => '/api/v1/me/delete',
            'me_delete_cancel' => '/api/v1/me/delete/cancel',
            'me_data_export' => '/api/v1/me/data-export',
            'me_reports' => '/api/v1/me/reports',
            'me_blocks' => '/api/v1/me/blocks',
            'user_block' => '/api/v1/users/{id}/block',
            'user_unblock' => '/api/v1/users/{id}/block',
            'report_create' => '/api/v1/reports',
            'support_tickets' => '/api/v1/support/tickets',
            'support_ticket_detail' => '/api/v1/support/tickets/{id}',
            'owner_applications' => '/api/v1/owner/applications',
            'media_upload' => '/api/v1/media',
            'saved_venues' => '/api/v1/me/saved-venues',
            'save_venue' => '/api/v1/venues/{id}/save',
            'saved_courts' => '/api/v1/me/saved-courts',
            'save_court' => '/api/v1/courts/{id}/save',
        ];
        if (! $showSubscriptionSurface) {
            unset(
                $endpoints['membership_plans'],
                $endpoints['me_membership'],
                $endpoints['membership_subscribe'],
                $endpoints['membership_portal'],
                $endpoints['membership_cancel'],
            );
        }
        if (! $showPaymentSurface) {
            unset($endpoints['payment_history'], $endpoints['payment_summary']);
        }
        $endpoints += [
            'owner_account' => '/api/v1/partner/account',
            'owner_bootstrap' => '/api/v1/partner/bootstrap',
            'owner_lookups' => '/api/v1/partner/lookups',
            'owner_venue' => '/api/v1/partner/venue',
            'owner_courts' => '/api/v1/partner/courts',
            'owner_dashboard' => '/api/v1/partner/stats',
            'owner_metrics' => '/api/v1/partner/metrics',
            'owner_today' => '/api/v1/partner/today',
            'owner_activity' => '/api/v1/partner/activity',
            'owner_customers' => '/api/v1/partner/customers',
            'owner_reviews' => '/api/v1/partner/reviews',
            'owner_user_search' => '/api/v1/partner/users/search?q=',
            'owner_availability' => '/api/v1/partner/availability?date=YYYY-MM-DD',
            'owner_calendar' => '/api/v1/partner/calendar',
            'owner_schedule' => '/api/v1/partner/schedule',
            'owner_revenue' => '/api/v1/partner/revenue',
            'owner_tournaments' => '/api/v1/partner/tournaments',
            'owner_tournament_detail' => '/api/v1/partner/tournaments/{id}',
            'owner_tournament_entries' => '/api/v1/partner/tournaments/{id}/entries',
            'owner_booking_quote' => '/api/v1/partner/bookings/quote',
            'owner_booking_holds' => '/api/v1/partner/booking-holds',
            'owner_booking_bulk_status' => '/api/v1/partner/bookings/bulk-status',
            'owner_bookings_export' => '/api/v1/partner/bookings/export',
            'owner_waitlist' => '/api/v1/partner/waitlist',
            'owner_booking_check_in' => '/api/v1/partner/bookings/{id}/check-in',
            'owner_booking_refund' => '/api/v1/partner/bookings/{id}/refund',
            'owner_booking_undo_check_in' => '/api/v1/partner/bookings/{id}/undo-check-in',
            'owner_booking_clear_no_show' => '/api/v1/partner/bookings/{id}/clear-no-show',
            'owner_blocks' => '/api/v1/partner/blocks',
            'owner_staff' => '/api/v1/partner/staff',
            'admin_bootstrap' => '/api/v1/admin/bootstrap',
            'admin_lookups' => '/api/v1/admin/lookups',
            'admin_metrics' => '/api/v1/admin/metrics',
            'admin_search' => '/api/v1/admin/search?q=',
            'admin_activity' => '/api/v1/admin/activity',
            'admin_audit' => '/api/v1/admin/audit',
            'admin_audit_export' => '/api/v1/admin/audit/export',
            'admin_announcements' => '/api/v1/admin/announcements',
            'admin_announcement_detail' => '/api/v1/admin/announcements/{id}',
            'admin_announcement_expire' => '/api/v1/admin/announcements/{id}/expire',
            'admin_notifications' => '/api/v1/admin/notifications',
            'admin_notification_detail' => '/api/v1/admin/notifications/{id}',
            'admin_notification_read' => '/api/v1/admin/notifications/{id}/read',
            'admin_support_tickets' => '/api/v1/admin/support/tickets',
            'admin_support_ticket_detail' => '/api/v1/admin/support/tickets/{id}',
            'admin_owner_applications' => '/api/v1/admin/owner-applications',
            'admin_owner_application_detail' => '/api/v1/admin/owner-applications/{id}',
            'admin_reviews' => '/api/v1/admin/reviews',
            'admin_promo_codes' => '/api/v1/admin/promo-codes',
            'admin_staff' => '/api/v1/admin/staff',
            'admin_customers' => '/api/v1/admin/customers',
            'admin_reports' => '/api/v1/admin/reports',
            'admin_report_detail' => '/api/v1/admin/reports/{id}',
            'admin_report_review' => '/api/v1/admin/reports/{id}/review',
            'admin_moderation_reports' => '/api/v1/admin/moderation/reports',
            'admin_moderation_report_detail' => '/api/v1/admin/moderation/reports/{id}',
            'admin_moderation_report_review' => '/api/v1/admin/moderation/reports/{id}/review',
            'admin_moderation_user' => '/api/v1/admin/moderation/users/{id}',
            'admin_moderation_user_deactivate' => '/api/v1/admin/moderation/users/{id}/deactivate',
            'admin_venues' => '/api/v1/admin/venues',
            'admin_courts' => '/api/v1/admin/courts',
            'admin_tournaments' => '/api/v1/admin/tournaments',
            'admin_tournament_detail' => '/api/v1/admin/tournaments/{id}',
            'admin_tournament_entries' => '/api/v1/admin/tournaments/{id}/entries',
            'admin_calendar' => '/api/v1/admin/calendar',
            'admin_revenue' => '/api/v1/admin/revenue',
            'admin_booking_quote' => '/api/v1/admin/bookings/quote',
            'admin_booking_holds' => '/api/v1/admin/booking-holds',
            'admin_booking_create' => '/api/v1/admin/bookings',
            'admin_booking_bulk_status' => '/api/v1/admin/bookings/bulk-status',
            'admin_bookings_export' => '/api/v1/admin/bookings/export',
            'admin_waitlist' => '/api/v1/admin/waitlist',
            'admin_booking_check_in' => '/api/v1/admin/bookings/{id}/check-in',
            'admin_booking_refund' => '/api/v1/admin/bookings/{id}/refund',
            'admin_booking_undo_check_in' => '/api/v1/admin/bookings/{id}/undo-check-in',
            'admin_booking_clear_no_show' => '/api/v1/admin/bookings/{id}/clear-no-show',
            'media_delete' => '/api/v1/media/{id}',
            'admin_operations' => '/api/v1/admin/operations',
        ];

        return response()->json([
            'api' => 'laravel',
            'brand' => 'linkfit',
            'supported_sports' => ['padel', 'tennis'],
            'api_key' => $this->apiKeyContract(),
            'launch' => $launch->publicPayload(),
            'features' => [
                'monetization_enabled' => $launch->monetizationEnabled(),
                'premium_unlocked_for_all' => $launch->premiumUnlockedForAll(),
                'booking_fee_enabled' => $launch->bookingFeeEnabled(),
                'service_fee_minor' => $launch->bookingServiceFeeMinor(),
                'online_payment_enabled' => $launch->onlinePaymentEnabled(),
                'referral_enabled' => $launch->referralEnabled(),
                'promo_enabled' => $launch->promoEnabled(),
            ],
            'clients' => $clients,
            'endpoints' => $endpoints,
        ]);
    }

    /**
     * Public app keys are optional client-identification metadata only. They
     * are deliberately separate from JWT auth and from private internal keys.
     *
     * @return array<string,mixed>
     */
    private function apiKeyContract(): array
    {
        return [
            'required' => (bool) config('app.require_api_key'),
            'header' => 'X-Linkfit-App-Key',
            'query_string_supported' => false,
            'public_client_key' => true,
            'replaces_user_auth' => false,
        ];
    }

    private function showPaymentSurface(): bool
    {
        return $this->showSubscriptionSurface()
            && (bool) config('membership.payments_enabled');
    }

    private function showSubscriptionSurface(): bool
    {
        return (bool) config('membership.public_subscriptions_enabled');
    }

    public function appleAppSiteAssociation(): JsonResponse
    {
        return response()->json([
            'applinks' => [
                'apps' => [],
                'details' => [],
            ],
        ])->header('Content-Type', 'application/json');
    }
}
