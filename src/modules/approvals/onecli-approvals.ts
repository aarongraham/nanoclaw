/**
 * OneCLI manual-approval handler — STUBBED.
 *
 * This install runs the native credential proxy (see src/credential-proxy.ts)
 * and does NOT use the OneCLI gateway. The OneCLI SDK is no longer a dependency.
 *
 * The real module long-polls `GET /api/approvals/pending` on the OneCLI gateway
 * and DMs an approver when the gateway flags a credentialed action. Without a
 * gateway to poll, there's nothing for this handler to do — every export below
 * is a no-op preserved so existing call sites in response-handler.ts and the
 * approvals module barrel continue to link.
 *
 * If you reintroduce OneCLI later, recover the real implementation from git
 * history (search for `configureManualApproval`) and re-add `@onecli-sh/sdk`
 * to package.json.
 */
import type { ChannelDeliveryAdapter } from '../../delivery.js';

export const ONECLI_ACTION = 'onecli_credential';

export function startOneCLIApprovalHandler(_adapter: ChannelDeliveryAdapter): void {
  // No-op. The native credential proxy does not request approvals.
}

export function stopOneCLIApprovalHandler(): void {
  // No-op.
}

export function resolveOneCLIApproval(_id: string, _decision: string): boolean {
  // Always returns false: no pending OneCLI approvals exist when the SDK is
  // disabled, so this handler never claims the response. The caller falls
  // through to DB-backed pending_approvals.
  return false;
}
