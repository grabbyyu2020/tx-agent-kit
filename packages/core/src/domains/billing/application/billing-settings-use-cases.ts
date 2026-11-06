import {
  AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS,
  AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS,
  AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS,
  AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS
} from '@tx-agent-kit/contracts'
import { type Context, Effect, Option } from 'effect'
import { badRequest, notFound } from '../../../errors.js'
import { toBillingSettings } from '../domain/billing-domain.js'
import {
  AutoRechargeAttemptStorePort,
  BillingStorePort,
  BillingUiPreferenceStorePort
} from '../ports/billing-ports.js'
import type { BillingService } from './billing-service.js'
import {
  assertBillingAccess,
  toCoreInternal,
  validateOptionalDecimillicentSetting
} from './billing-use-case-support.js'

type BillingServiceShape = Context.Tag.Service<typeof BillingService>

export const billingSettingsUseCases: Pick<
  BillingServiceShape,
  | 'getBillingSettings'
  | 'updateBillingSettings'
  | 'getNoCapReminderPreference'
  | 'dismissNoCapReminder'
  | 'getAutoRechargeRequiresActionChallenge'
> = {
  getBillingSettings: (principal, organizationId) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(organizationId, principal, false)
      const billingStore = yield* BillingStorePort

      const settings = yield* billingStore.getSubscriptionFields(organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      return toBillingSettings(settings)
    }),

  updateBillingSettings: (principal, organizationId, input) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(organizationId, principal, true)
      const billingStore = yield* BillingStorePort

      const settingError =
        validateOptionalDecimillicentSetting(
          'autoRechargeThresholdDecimillicents',
          input.autoRechargeThresholdDecimillicents,
          AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS,
          AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS
        )
        ?? validateOptionalDecimillicentSetting(
          'autoRechargeAmountDecimillicents',
          input.autoRechargeAmountDecimillicents,
          AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS,
          AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
        )
        ?? validateOptionalDecimillicentSetting(
          'usageCapDecimillicents',
          input.usageCapDecimillicents,
          0
        )
      if (settingError) {
        return yield* Effect.fail(settingError)
      }

      // Semantic consistency: an enabled auto-recharge row requires
      // BOTH a non-null threshold AND a non-null amount. Without
      // these, the worker's `runAutoRechargeTrigger` silently no-ops
      // on every low-balance signal (see amount <= 0 guard in
      // apps/worker/src/billing-activities.ts) — the user sees
      // "auto-recharge enabled" in the UI, their card never gets
      // charged, they burn through their credits, and are then
      // suspended. Compute the post-patch state and reject the update
      // if it would produce an inconsistent row, including patches
      // that clear amount/threshold while the existing row is already
      // enabled.
      //
      // Partial updates: if a field is undefined in the patch the
      // existing value stays, so we need the current org row to
      // merge.
      const touchesAutoRechargeState =
        input.autoRechargeEnabled !== undefined
        || input.autoRechargeThresholdDecimillicents !== undefined
        || input.autoRechargeAmountDecimillicents !== undefined
      if (touchesAutoRechargeState) {
        const currentOpt = yield* billingStore.getSubscriptionFields(organizationId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch billing settings'))
        )
        if (Option.isNone(currentOpt)) {
          return yield* Effect.fail(notFound('Organization not found'))
        }
        const current = currentOpt.value
        const nextEnabled = input.autoRechargeEnabled ?? current.autoRechargeEnabled
        // A patch `null` value clears the field; `undefined` keeps it.
        const nextThreshold = input.autoRechargeThresholdDecimillicents === undefined
          ? current.autoRechargeThreshold
          : input.autoRechargeThresholdDecimillicents
        const nextAmount = input.autoRechargeAmountDecimillicents === undefined
          ? current.autoRechargeAmount
          : input.autoRechargeAmountDecimillicents
        if (nextEnabled && (nextThreshold === null || nextAmount === null)) {
          return yield* Effect.fail(badRequest(
            'Enabling auto-recharge requires both autoRechargeThresholdDecimillicents and autoRechargeAmountDecimillicents to be set'
          ))
        }
      }

      const updated = yield* billingStore.updateBillingSettings({
        organizationId,
        billingEmail: input.billingEmail,
        autoRechargeEnabled: input.autoRechargeEnabled,
        autoRechargeThreshold: input.autoRechargeThresholdDecimillicents,
        autoRechargeAmount: input.autoRechargeAmountDecimillicents,
        usageCap: input.usageCapDecimillicents
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to update billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      return toBillingSettings(updated)
    }),

  getNoCapReminderPreference: (principal, organizationId) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(organizationId, principal, true)
      const preferenceStore = yield* BillingUiPreferenceStorePort

      const dismissed = yield* preferenceStore
        .isNoCapReminderDismissed(principal.userId, organizationId)
        .pipe(
          Effect.mapError(toCoreInternal('Failed to fetch no-cap reminder preference'))
        )

      return { dismissed }
    }),

  dismissNoCapReminder: (principal, organizationId) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(organizationId, principal, true)
      const preferenceStore = yield* BillingUiPreferenceStorePort

      yield* preferenceStore
        .dismissNoCapReminder(principal.userId, organizationId)
        .pipe(
          Effect.mapError(toCoreInternal('Failed to dismiss no-cap reminder'))
        )

      return { dismissed: true }
    }),

  getAutoRechargeRequiresActionChallenge: (principal, organizationId) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(organizationId, principal, true)
      const attemptStore = yield* AutoRechargeAttemptStorePort

      return yield* attemptStore
        .findLatestRequiresActionChallenge(organizationId)
        .pipe(
          Effect.mapError(toCoreInternal('Failed to fetch auto-recharge 3DS challenge'))
        )
    })
}
