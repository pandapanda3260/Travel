import {
  COMMERCIAL_BILLING_BASELINE,
  COMMERCIAL_CREDIT_PACKAGES,
  COMMERCIAL_MEMBERSHIP_PLANS,
  COMMERCIAL_VIDEO_PRICING,
  calculateCreditProductMargin,
  calculateVideoFeatureMargin,
} from "./commercial-billing-config";
import { getCommercialCreditBalance, listCreditTransactionsByUserId } from "./commercial-credit-ledger";
import { getActiveUserCommercialMembership, getUserCommercialMembership } from "./commercial-order-service";

export function getCommercialProductsPayload() {
  return {
    baseline: COMMERCIAL_BILLING_BASELINE,
    membershipPlans: COMMERCIAL_MEMBERSHIP_PLANS.map((plan) => ({
      ...plan,
      margin: calculateCreditProductMargin(plan),
    })),
    creditPackages: COMMERCIAL_CREDIT_PACKAGES.map((item) => ({
      ...item,
      margin: calculateCreditProductMargin(item),
    })),
    videoPricing: COMMERCIAL_VIDEO_PRICING.map((item) => ({
      ...item,
      margin: calculateVideoFeatureMargin(item),
    })),
  };
}

export function getCommercialCreditAccountPayload(userId: string) {
  return {
    balance: getCommercialCreditBalance(userId),
    membership: getUserCommercialMembership(userId),
    activeMembership: getActiveUserCommercialMembership(userId),
    transactions: listCreditTransactionsByUserId(userId, 100),
  };
}
