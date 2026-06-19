const PLACEHOLDER_STRIPE_SECRET_KEYS = new Set([
  "sk_test_dummy",
  "sk_live_dummy",
]);

const PLACEHOLDER_STRIPE_WEBHOOK_SECRETS = new Set([
  "whsec_test_dummy",
  "whsec_live_dummy",
]);

export function isPlaceholderStripeSecretKey(secret: string): boolean {
  return secret.length === 0 || PLACEHOLDER_STRIPE_SECRET_KEYS.has(secret);
}

export function isPlaceholderStripeWebhookSecret(secret: string): boolean {
  return secret.length === 0 || PLACEHOLDER_STRIPE_WEBHOOK_SECRETS.has(secret);
}
