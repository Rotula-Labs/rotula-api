-- Record the asset (code + issuer) alongside the requested amount
-- so a payment request is honoured in the asset it was created with,
-- even if the configured asset changes later.

ALTER TABLE "PaymentRequest"
    ADD COLUMN "assetCode" TEXT,
    ADD COLUMN "assetIssuer" TEXT;

-- Backfill existing rows with the native asset. The service treats a
-- NULL asset as "use the configured asset", so this keeps legacy rows
-- working while making the stored value explicit and attributable in
-- reconciliation queries.
UPDATE "PaymentRequest"
SET "assetCode" = 'XLM',
    "assetIssuer" = NULL
WHERE "assetCode" IS NULL;
