# Resend Support Inbound Webhook

Status: implementation verified locally; production deployment and Webhook delivery verification required

WHICH receives `support@which.site` mail through Resend Receiving. Resend remains the mailbox and
source of the full message. WHICH stores only bounded metadata in `operator_audit_logs`; it does not
fetch or persist the email body, raw MIME data, headers, or attachment names and files.

## Production setup

1. Deploy the Web and API changes together.
2. In Resend, open **Webhooks → Add webhook**.
3. Set the endpoint to `https://whichone.site/api/webhooks/resend`.
4. Subscribe only to `email.received`.
5. Copy the generated Signing Secret into the Web service as `RESEND_WEBHOOK_SECRET`.
6. Set both `SUPPORT_EMAIL` and `RESEND_INBOUND_SUPPORT_ADDRESS` to `support@which.site`.
7. Redeploy the Web service so the Signing Secret is available to the route.
8. Send a test message to `support@which.site` and confirm a successful Webhook delivery in Resend.

Do not use the Resend API key as the Webhook Signing Secret. Keep `RESEND_WEBHOOK_SECRET` on the Web
service only and rotate it if a value is exposed.

## Processing contract

- The public Web route reads the raw body and verifies `svix-id`, `svix-timestamp`, and
  `svix-signature` with the Resend SDK.
- Events other than `email.received` and recipients other than `support@which.site` are acknowledged
  and ignored.
- Accepted metadata crosses the existing Web-to-API internal-secret boundary.
- The API takes a PostgreSQL advisory lock on the Resend event ID and records one audit row. A
  delivery replay returns `REPLAYED` without inserting a duplicate.
- API persistence failures return `502`, allowing Resend to retry delivery.

## Verification query

```sql
SELECT
  occurred_at,
  request_id AS resend_event_id,
  metadata->>'emailId' AS resend_email_id,
  metadata->>'sender' AS sender,
  metadata->>'recipient' AS recipient,
  metadata->>'subject' AS subject,
  metadata->>'attachmentCount' AS attachment_count,
  metadata->>'contentStored' AS content_stored
FROM operator_audit_logs
WHERE event_type = 'RESEND_SUPPORT_EMAIL_RECEIVED'
ORDER BY occurred_at DESC
LIMIT 20;
```

`content_stored` must remain `false`. Review message bodies and attachments in Resend only when
needed for an active support or incident case.
