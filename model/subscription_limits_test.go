package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func insertActiveSubscriptionForLimitTest(t *testing.T, sub *UserSubscription) {
	t.Helper()
	now := time.Now().Unix()
	if sub.StartTime == 0 {
		sub.StartTime = now
	}
	if sub.EndTime == 0 {
		sub.EndTime = now + 30*24*3600
	}
	if sub.Status == "" {
		sub.Status = "active"
	}
	require.NoError(t, DB.Create(sub).Error)
}

func TestPreConsumeUserSubscription_RespectsFiveHourLimit(t *testing.T) {
	truncateTables(t)

	insertActiveSubscriptionForLimitTest(t, &UserSubscription{
		Id:                  9001,
		UserId:              101,
		PlanId:              1,
		AmountTotal:         1000,
		AmountFiveHourLimit: 100,
	})

	_, err := PreConsumeUserSubscription("sub-limit-req-1", 101, "gpt-test", 0, 60)
	require.NoError(t, err)

	_, err = PreConsumeUserSubscription("sub-limit-req-2", 101, "gpt-test", 0, 50)
	require.Error(t, err)
}

func TestRefundSubscriptionPreConsume_ReleasesRollingLimit(t *testing.T) {
	truncateTables(t)

	insertActiveSubscriptionForLimitTest(t, &UserSubscription{
		Id:               9002,
		UserId:           102,
		PlanId:           1,
		AmountTotal:      1000,
		AmountDailyLimit: 100,
	})

	_, err := PreConsumeUserSubscription("sub-refund-req-1", 102, "gpt-test", 0, 80)
	require.NoError(t, err)
	require.NoError(t, RefundSubscriptionPreConsume("sub-refund-req-1"))

	_, err = PreConsumeUserSubscription("sub-refund-req-2", 102, "gpt-test", 0, 90)
	require.NoError(t, err)
}

func TestPreConsumeUserSubscription_RespectsModelLimits(t *testing.T) {
	truncateTables(t)

	insertActiveSubscriptionForLimitTest(t, &UserSubscription{
		Id:                 9003,
		UserId:             103,
		PlanId:             1,
		AmountTotal:        1000,
		ModelLimitsEnabled: true,
		ModelLimits:        "gpt-4.1",
	})

	_, err := PreConsumeUserSubscription("sub-model-limit-req-1", 103, "gpt-5.4", 0, 60)
	require.Error(t, err)

	_, err = PreConsumeUserSubscription("sub-model-limit-req-2", 103, "gpt-4.1", 0, 60)
	require.NoError(t, err)
}

func TestPreConsumeUserSubscription_SkipsIneligibleSubscriptionByModelLimits(t *testing.T) {
	truncateTables(t)

	insertActiveSubscriptionForLimitTest(t, &UserSubscription{
		Id:                 9004,
		UserId:             104,
		PlanId:             1,
		AmountTotal:        1000,
		ModelLimitsEnabled: true,
		ModelLimits:        "gpt-4.1",
	})
	insertActiveSubscriptionForLimitTest(t, &UserSubscription{
		Id:          9005,
		UserId:      104,
		PlanId:      2,
		AmountTotal: 1000,
	})

	res, err := PreConsumeUserSubscription("sub-model-limit-req-3", 104, "gpt-5.4", 0, 80)
	require.NoError(t, err)
	require.Equal(t, 9005, res.UserSubscriptionId)
}

func TestCalculateSubscriptionRefundQuota_BasedOnUnusedAmount(t *testing.T) {
	sub := &UserSubscription{
		PaidAmount: 800000,
		AmountUsed: 230000,
		StartTime:  time.Now().Add(-2 * time.Hour).Unix(),
		EndTime:    time.Now().Add(28 * 24 * time.Hour).Unix(),
		Status:     "active",
		Source:     "wallet",
		CreatedAt:  time.Now().Unix(),
		UpdatedAt:  time.Now().Unix(),
	}

	require.Equal(t, int64(570000), calculateSubscriptionRefundQuota(sub))
}

func TestCalculateSubscriptionRefundQuota_NeverNegative(t *testing.T) {
	sub := &UserSubscription{
		PaidAmount: 300000,
		AmountUsed: 420000,
	}

	require.Zero(t, calculateSubscriptionRefundQuota(sub))
}
