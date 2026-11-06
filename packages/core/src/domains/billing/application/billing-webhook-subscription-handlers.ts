import {
  PAYMENT_GRACE_PERIOD_MS,
  TOP_UP_MAX_DECIMILLICENTS,
  WELCOME_CREDIT_DECIMILLICENTS
} from '@tx-agent-kit/contracts'
import { Effect, Option } from 'effect'
import { badRequest, type CoreError } from '../../../errors.js'
import { canAccessFeature } from '../domain/billing-domain.js'
import {
  collectSubscriptionPriceIds,
  parseSubscriptionPlan,
  parseSubscriptionStatus,
  readCentsAsDecimillicents,
  readNumberField,
  readObjectField,
  readStringField,
  toDateFromUnixSeconds
} from './billing-event-fields.js'
import {
  isPositiveSafeInteger,
  toCoreInternal,
  type BillingWebhookHandlerInput
} from './billing-use-case-support.js'

// checkout.session.completed
export const handleCheckoutSessionCompleted = ({
  event,
  organizationId,
  billingStore,
  creditService
}: BillingWebhookHandlerInput): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    const checkoutMode = readStringField(event.data.object, 'mode')
    const amountDecimillicents = readCentsAsDecimillicents(event.data.object, 'amount_total')
    // @spec INV-BILLING-005 — validate one-time payment checkouts
    // before any local billing field updates. A malformed top-up
    // webhook must fail closed without partially linking a Stripe
    // customer, payment method, subscription id, or plan while the
    // processed_stripe_events claim is released for retry.
    if (
      checkoutMode === 'payment'
      && (
        amountDecimillicents === null
        || !isPositiveSafeInteger(amountDecimillicents)
        || amountDecimillicents > TOP_UP_MAX_DECIMILLICENTS
      )
    ) {
      return yield* Effect.fail(
        badRequest(
          `checkout.session.completed ${event.id} payment mode is missing a usable positive amount_total field within the top-up maximum`
        )
      )
    }
    const paymentMethodId = readStringField(event.data.object, 'payment_method')
    const checkoutSubscriptionId = checkoutMode === 'payment'
      ? null
      : readStringField(event.data.object, 'subscription')
    const checkoutPlan = checkoutMode === 'payment'
      ? null
      : parseSubscriptionPlan(
        readStringField(readObjectField(event.data.object, 'metadata') ?? {}, 'subscriptionPlan')
      )
    // CRITICAL: a top-up checkout (mode=payment) has no
    // subscription field on the session, so reading it returns
    // null. The previous handler unconditionally set
    // stripeSubscriptionId to that null, which WIPED the active
    // subscription pointer for any user that topped up while
    // subscribed. Never persist subscription ids or plans from
    // payment-mode top-ups; only subscription-mode checkouts own
    // those fields.
    yield* billingStore.updateSubscriptionFields({
      organizationId,
      stripeCustomerId: readStringField(event.data.object, 'customer'),
      ...(checkoutSubscriptionId !== null
        ? { stripeSubscriptionId: checkoutSubscriptionId }
        : {}),
      ...(checkoutPlan !== null
        ? { subscriptionPlan: checkoutPlan }
        : {}),
      ...(paymentMethodId !== null ? { stripePaymentMethodId: paymentMethodId } : {})
    }).pipe(Effect.mapError(toCoreInternal('Failed to persist checkout webhook state')))

    // @spec INV-BILLING-005 — only one-time payment checkouts grant
    // credits. Subscription-mode checkouts are handled by the
    // recurring invoice.payment_succeeded pathway (intentionally
    // excluded here so existing subscription tests are unaffected).
    if (checkoutMode === 'payment') {
      const purchaseAmountDecimillicents = amountDecimillicents
      if (purchaseAmountDecimillicents === null) {
        return yield* Effect.fail(
          badRequest(
            `checkout.session.completed ${event.id} payment mode is missing a usable positive amount_total field`
          )
        )
      }
      yield* creditService.creditsPurchased({
        organizationId,
        amountDecimillicents: purchaseAmountDecimillicents,
        stripeEventId: event.id,
        referenceId: `stripe:checkout:${event.id}`,
        reason: 'Credit purchase via Stripe checkout'
      })
    }
  })

// customer.subscription.created / customer.subscription.updated
export const handleSubscriptionCreatedOrUpdated = ({
  event,
  organizationId,
  billingStore,
  stripe
}: BillingWebhookHandlerInput): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    const status = parseSubscriptionStatus(readStringField(event.data.object, 'status')) ?? 'inactive'
    const startDate = toDateFromUnixSeconds(readNumberField(event.data.object, 'start_date'))
    const endedAt = toDateFromUnixSeconds(
      readNumberField(event.data.object, 'ended_at') ?? readNumberField(event.data.object, 'cancel_at')
    )
    const currentPeriodEnd = toDateFromUnixSeconds(readNumberField(event.data.object, 'current_period_end'))
    const eventSubscriptionId = readStringField(event.data.object, 'id')
    // Derive the plan slug from the actual line items rather
    // than hardcoding 'pro'. The historical bug was a fixed
    // 'pro' write that caused try_me subscribers to receive
    // the Pro welcome credit ($20 instead of $9) and agency
    // subscribers to receive less than they were owed
    // ($20 instead of $45). The resolver returns 'pro' as a
    // safe default when no configured price id matches.
    // Webhook ordering tolerance: gate on the event's sub id
    // matching the org's current stripe_subscription_id when
    // one is set. Applies to BOTH .created and .updated:
    //
    //   - .updated: also gated by `onlyIfStatusIn` excluding
    //     canceled (the resurrection guard from ba78366).
    //   - .created: protects against a stale .created retry
    //     for an OLD subscription landing after the user has
    //     already started a yet-newer one. Brand-new orgs
    //     and re-subscribe-after-cancel both pass the gate
    //     (current_sub_id is null in those cases — the
    //     `.deleted` handler nulls it on cancel).
    //
    // The sub-id-match gate is necessary because Stripe's
    // at-least-once delivery + retries can ship a `.created`
    // or `.updated` from an OLD subscription long after the
    // user has cancelled and started a fresh one, and the
    // unconditional handler would clobber the active sub's row.
    let staleUpdate = false
    const currentSettingsOpt = yield* billingStore
      .getSubscriptionFields(organizationId)
      .pipe(Effect.mapError(toCoreInternal('Failed to read settings for subscription gate')))
    const currentSubscriptionId = Option.match(currentSettingsOpt, {
      onNone: () => null,
      onSome: (s) => s.stripeSubscriptionId
    })
    if (eventSubscriptionId === null) {
      return yield* Effect.fail(
        badRequest(`${event.type} ${event.id} is missing a usable subscription id`)
      )
    }
    const currentSubscriptionPlan = Option.match(currentSettingsOpt, {
      onNone: () => null,
      onSome: (s) => parseSubscriptionPlan(s.subscriptionPlan)
    })
    const planFromEvent = parseSubscriptionPlan(
      readStringField(readObjectField(event.data.object, 'metadata') ?? {}, 'subscriptionPlan')
    )
    const subscriptionPriceIds = collectSubscriptionPriceIds(event.data.object)
    const resolvedPlan = planFromEvent
      ?? currentSubscriptionPlan
      ?? stripe.resolvePlanFromPriceIds(subscriptionPriceIds)
    if (
      currentSubscriptionId !== null
      && eventSubscriptionId !== currentSubscriptionId
    ) {
      yield* Effect.logWarning(
        `${event.type} ${event.id} for stale sub id ${eventSubscriptionId}; current is ${currentSubscriptionId} — ignoring`
      )
      staleUpdate = true
    }

    if (!staleUpdate) {
      const updateOrderingGuard =
        event.type === 'customer.subscription.updated'
          ? {
              onlyIfStatusIn: [
                'active',
                'trialing',
                'past_due',
                'unpaid',
                'paused',
                'inactive'
              ] as const
            }
          : {}

      yield* billingStore.updateSubscriptionFields({
        organizationId,
        stripeCustomerId: readStringField(event.data.object, 'customer'),
        stripeSubscriptionId: eventSubscriptionId,
        stripeMeteredSubscriptionItemId: null,
        isSubscribed: canAccessFeature(resolvedPlan, status, 'free'),
        subscriptionStatus: status,
        subscriptionPlan: resolvedPlan,
        subscriptionStartedAt: startDate,
        subscriptionEndsAt: endedAt,
        subscriptionCurrentPeriodEnd: currentPeriodEnd,
        ...updateOrderingGuard
      }).pipe(Effect.mapError(toCoreInternal('Failed to persist subscription webhook state')))
    }
  })

// customer.subscription.deleted
export const handleSubscriptionDeleted = ({
  event,
  organizationId,
  billingStore,
  clock
}: BillingWebhookHandlerInput): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    // Gate on the event's subscription id matching the org's
    // current stripe_subscription_id. A late-delivered .deleted
    // for an OLD subscription (the user canceled + re-subscribed
    // out-of-order from Stripe's perspective) would otherwise
    // wipe out the newer active sub's row. Same pattern as the
    // .updated guard in ba78366 but for cancellation.
    const eventSubscriptionId = readStringField(event.data.object, 'id')
    if (eventSubscriptionId === null) {
      return yield* Effect.fail(
        badRequest(`customer.subscription.deleted ${event.id} is missing a usable subscription id`)
      )
    }
    const currentSettingsOpt = yield* billingStore
      .getSubscriptionFields(organizationId)
      .pipe(Effect.mapError(toCoreInternal('Failed to read settings for subscription.deleted gate')))
    const currentSubscriptionId = Option.match(currentSettingsOpt, {
      onNone: () => null,
      onSome: (s) => s.stripeSubscriptionId
    })
    if (
      currentSubscriptionId !== null
      && eventSubscriptionId !== currentSubscriptionId
    ) {
      // Stale delete for a previous subscription — drop on the
      // floor. The current sub stays intact. Effect's default
      // logger surfaces the warning without needing a console
      // import in this pure-service layer.
      yield* Effect.logWarning(
        `customer.subscription.deleted ${event.id} for stale sub id ${eventSubscriptionId}; current is ${currentSubscriptionId} — ignoring`
      )
    } else {
      const endedAt = toDateFromUnixSeconds(
        readNumberField(event.data.object, 'ended_at') ?? readNumberField(event.data.object, 'cancel_at')
      ) ?? (yield* clock.now())
      yield* billingStore.updateSubscriptionFields({
        organizationId,
        isSubscribed: false,
        subscriptionStatus: 'canceled',
        subscriptionEndsAt: endedAt,
        stripeSubscriptionId: null,
        stripeMeteredSubscriptionItemId: null
      }).pipe(Effect.mapError(toCoreInternal('Failed to persist cancellation webhook state')))
    }
  })

// invoice.payment_failed / invoice.payment_succeeded
export const handleInvoicePayment = ({
  event,
  organizationId,
  billingStore,
  clock,
  creditLedgerStore
}: BillingWebhookHandlerInput): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    // Gate invoice.* events on the invoice's subscription id
    // matching the org's current stripe_subscription_id. A
    // stale invoice retry from a PREVIOUS subscription would
    // otherwise corrupt the current active sub's status (the
    // .updated/.deleted gates only protect their own event
    // type — invoice.* writes have a separate code path). The
    // invoice carries the subscription id in
    // event.data.object.subscription.
    const invoiceSubscriptionId = readStringField(event.data.object, 'subscription')
    const currentSettingsOpt = yield* billingStore
      .getSubscriptionFields(organizationId)
      .pipe(Effect.mapError(toCoreInternal('Failed to read settings for invoice gate')))
    const currentSubscriptionId = Option.match(currentSettingsOpt, {
      onNone: () => null,
      onSome: (s) => s.stripeSubscriptionId
    })
    const currentSubscriptionStatus = Option.match(currentSettingsOpt, {
      onNone: () => null,
      onSome: (s) => s.subscriptionStatus
    })
    if (invoiceSubscriptionId === null) {
      return yield* Effect.fail(
        badRequest(`${event.type} ${event.id} is missing a usable subscription id`)
      )
    }
    if (currentSubscriptionId === null && currentSubscriptionStatus !== 'canceled') {
      return yield* Effect.fail(
        badRequest(
          `${event.type} ${event.id} arrived before subscription ${invoiceSubscriptionId} was linked locally`
        )
      )
    }
    const staleInvoice =
      currentSubscriptionId !== null
      && invoiceSubscriptionId !== currentSubscriptionId

    if (staleInvoice) {
      yield* Effect.logWarning(
        `${event.type} ${event.id} for stale sub id ${invoiceSubscriptionId}; current is ${currentSubscriptionId} — ignoring`
      )
    } else if (event.type === 'invoice.payment_failed') {
      // @spec billing-and-pricing-design §"Payment Failure Lifecycle"
      // Set `paymentGracePeriodEndsAt` synchronously alongside the
      // status=past_due write so the reserve-time guard at
      // credit-ledger.ts sees a non-null column immediately. Previously
      // the worker's `startPaymentGracePeriod` activity was the sole
      // writer, leaving a short window where the org was past_due but
      // the column was still null — `reserve()` would allow new spend
      // during that window, violating the spec's "operations suspended"
      // rule. The worker activity still runs (sends the notification
      // email + reasserts the column idempotently).
      const gracePeriodEndsAt = new Date(
        (yield* clock.now()).getTime() + PAYMENT_GRACE_PERIOD_MS
      )
      yield* billingStore.updateSubscriptionFields({
        organizationId,
        isSubscribed: true,
        subscriptionStatus: 'past_due',
        paymentGracePeriodEndsAt: gracePeriodEndsAt,
        onlyIfStatusIn: ['active', 'trialing', 'past_due']
      }).pipe(Effect.mapError(toCoreInternal('Failed to persist failed payment webhook state')))
    } else {
      // @spec billing-and-pricing-design §"Failed Payment Lifecycle"
      // Clear the payment grace period on a successful payment —
      // otherwise the column stays non-null forever and the reserve
      // guard keeps the org blocked even after Stripe confirms the
      // recovery.
      yield* billingStore.updateSubscriptionFields({
        organizationId,
        isSubscribed: true,
        subscriptionStatus: 'active',
        paymentGracePeriodEndsAt: null,
        onlyIfStatusIn: ['active', 'past_due', 'trialing', 'unpaid']
      }).pipe(Effect.mapError(toCoreInternal('Failed to persist payment success webhook state')))

      // @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
      // @spec INV-BILLING-CREDITS-NEVER-EXPIRE
      // @spec billing-and-pricing-design §"Welcome Credits"
      //
      // On the FIRST successful invoice.payment_succeeded for this
      // org, grant a one-time welcome credit in decimillicents per
      // the plan tier. The guard is `welcome_credit_granted_at IS
      // NULL` on the org row. The underlying creditLedgerStore.append
      // is idempotent via the referenceId `welcome:${orgId}` which
      // is globally unique per org (not per event) — so every future
      // renewal of any invoice converges to a no-op even if the
      // column write falls behind.
      //
      // Welcome credits must NOT be granted on renewal charges.
      // Welcome credits must NOT re-grant on plan upgrade.
      // Welcome credits never expire (no scheduled purge).
      // Welcome credits are refund-forgiven (see charge.refunded
      // handler below — it skips the debit when the charge has
      // an `invoice` field set, i.e. the charge originated from
      // a subscription invoice rather than a top-up PaymentIntent).
      const welcomeGrantedAt = Option.match(currentSettingsOpt, {
        onNone: () => null,
        onSome: (s) => s.welcomeCreditGrantedAt
      })
      const subscriptionPlanSlug = Option.match(currentSettingsOpt, {
        onNone: () => null,
        onSome: (s) => s.subscriptionPlan
      })
      const welcomeAmount: number | null = (() => {
        if (subscriptionPlanSlug === 'try_me') {
          return WELCOME_CREDIT_DECIMILLICENTS.try_me
        }
        if (subscriptionPlanSlug === 'pro') {
          return WELCOME_CREDIT_DECIMILLICENTS.pro
        }
        if (subscriptionPlanSlug === 'agency') {
          return WELCOME_CREDIT_DECIMILLICENTS.agency
        }
        return null
      })()

      if (welcomeGrantedAt === null && welcomeAmount !== null && subscriptionPlanSlug !== null) {
        // Atomic grant: the credit_ledger insert, the
        // billing.welcome_credit_granted outbox event, AND the
        // organizations.welcome_credit_granted_at column stamp
        // all commit inside ONE db.transaction inside the
        // credit-ledger repo. Closes the historical hole
        // where the column was a separate post-write and a
        // crash between the ledger commit and the stamp would
        // leave the column NULL, causing every monthly renewal
        // to re-enter the grant branch (the referenceId guard
        // would still prevent double-granting, but the loop
        // would never converge).
        const grantedAt = yield* clock.now()
        yield* creditLedgerStore
          .append({
            organizationId,
            entryType: 'adjustment',
            amountDecimillicents: welcomeAmount,
            reason: 'welcome_credit',
            // Globally unique per org (not per event) — renewals
            // collapse to an idempotent no-op via the repo's
            // referenceId existence check.
            referenceId: `welcome:${organizationId}`,
            stripeEventId: event.id,
            metadata: {
              plan: subscriptionPlanSlug,
              source: 'invoice.payment_succeeded'
            },
            outboxEvent: {
              eventType: 'billing.welcome_credit_granted',
              aggregateType: 'billing',
              aggregateId: organizationId,
              payload: {
                organizationId,
                amountDecimillicents: welcomeAmount,
                plan: subscriptionPlanSlug,
                stripeEventId: event.id
              },
              correlationId: null
            },
            stampWelcomeCreditAt: grantedAt
          })
          .pipe(Effect.mapError(toCoreInternal('Failed to grant welcome credit')))
      }
    }
  })
