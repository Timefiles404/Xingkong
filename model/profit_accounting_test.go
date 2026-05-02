package model

import (
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func insertProfitTestUser(t *testing.T, id int, quota int) {
	t.Helper()
	require.NoError(t, DB.Create(&User{
		Id:       id,
		Username: "profit-user-" + common.GetRandomString(6),
		Password: "x",
		Quota:    quota,
		Status:   common.UserStatusEnabled,
		Role:     common.RoleCommonUser,
	}).Error)
}

func TestIncreaseUserQuotaCreatesWalletLot(t *testing.T) {
	truncateTables(t)
	insertProfitTestUser(t, 101, 0)

	require.NoError(t, IncreaseUserQuotaWithSource(101, 250, true, ProfitLotSourceGift, "unit_test_credit"))

	var user User
	require.NoError(t, DB.First(&user, 101).Error)
	assert.Equal(t, 250, user.Quota)

	var lots []WalletLot
	require.NoError(t, DB.Where("user_id = ?", 101).Find(&lots).Error)
	require.Len(t, lots, 1)
	assert.Equal(t, int64(250), lots[0].QuotaTotal)
	assert.Equal(t, int64(250), lots[0].QuotaRemaining)
	assert.Equal(t, ProfitLotSourceGift, lots[0].SourceType)
	assert.Equal(t, "unit_test_credit", lots[0].SourceNote)
}

func TestTopUpPaymentFeeCreatesLedgerAndNetCash(t *testing.T) {
	truncateTables(t)
	insertProfitTestUser(t, 102, 0)

	topup := &TopUp{
		UserId:        102,
		Amount:        1000,
		Money:         10,
		PaymentFeeCNY: 0.6,
		TradeNo:       "topup-fee-test",
		PaymentMethod: PaymentMethodStripe,
		Status:        common.TopUpStatusSuccess,
		CreateTime:    time.Now().Unix(),
		CompleteTime:  time.Now().Unix(),
	}
	require.NoError(t, DB.Create(topup).Error)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		if err := CreateWalletLotFromTopUpTx(tx, topup, 1000, ProfitLotSourceTopUp); err != nil {
			return err
		}
		return RecordPaymentFeeLedgerForTopUpTx(tx, topup)
	}))

	var lot WalletLot
	require.NoError(t, DB.Where("source_type = ? AND source_id = ?", ProfitLotSourceTopUp, topup.Id).First(&lot).Error)
	assert.InDelta(t, 10, lot.GrossCNYBasis, 0.000001)
	assert.InDelta(t, 0.6, lot.PaymentFeeCNY, 0.000001)
	assert.InDelta(t, 9.4, lot.CashNetCNY, 0.000001)

	var ledger FinanceLedger
	require.NoError(t, DB.Where("related_type = ? AND related_id = ?", "topup", topup.Id).First(&ledger).Error)
	assert.Equal(t, ProfitFinanceTypePaymentFee, ledger.Type)
	assert.InDelta(t, -0.6, ledger.AmountCNY, 0.000001)
}

func TestRecordUsageSettlementSplitsWalletLotsAndSubtractsUpstreamCostFromCashFlow(t *testing.T) {
	truncateTables(t)
	insertProfitTestUser(t, 103, 100)

	channel := &Channel{Id: 201, Name: "profit-channel"}
	require.NoError(t, DB.Create(channel).Error)
	modelRow := &Model{
		ModelName: "profit-model",
		AdminMeta: `{"upstreamPricing":{"pricingMode":"per-token","ratio":1,"completionRatio":2,"cacheRatio":0.5}}`,
	}
	require.NoError(t, DB.Create(modelRow).Error)

	require.NoError(t, DB.Create(&WalletLot{
		UserId:            103,
		SourceType:        ProfitLotSourceTopUp,
		QuotaTotal:        60,
		QuotaRemaining:    60,
		GrossCNYBasis:     6,
		GrossCNYRemaining: 6,
		OriginalUSDValue:  0.006,
		CashNetCNY:        6,
		SourceNote:        "lot-a",
	}).Error)
	require.NoError(t, DB.Create(&WalletLot{
		UserId:            103,
		SourceType:        ProfitLotSourceTopUp,
		QuotaTotal:        40,
		QuotaRemaining:    40,
		GrossCNYBasis:     4,
		GrossCNYRemaining: 4,
		OriginalUSDValue:  0.004,
		CashNetCNY:        4,
		SourceNote:        "lot-b",
	}).Error)

	err := RecordUsageSettlement(ProfitUsageInput{
		RequestId:                         "req-split-wallet",
		UserId:                            103,
		SourceType:                        ProfitLotTypeWallet,
		ModelName:                         "profit-model",
		ChannelId:                         201,
		PromptTokens:                      600,
		CompletionTokens:                  400,
		CacheReadTokens:                   200,
		CacheWriteTokens:                  100,
		QuotaUsed:                         100,
		DownstreamPricingMode:             "per-token",
		DownstreamModelRatioSnapshot:      2.5,
		DownstreamCompletionRatioSnapshot: 6,
		DownstreamCacheRatioSnapshot:      0.5,
		DownstreamCacheWriteRatioSnapshot: 1.25,
		DownstreamGroupRatioSnapshot:      1,
	})
	require.NoError(t, err)

	var rows []UsageSettlement
	require.NoError(t, DB.Where("request_id = ?", "req-split-wallet").Order("id asc").Find(&rows).Error)
	require.Len(t, rows, 2)

	var totalPrompt int64
	var totalCompletion int64
	var totalCacheRead int64
	var totalCacheWrite int64
	var totalQuota int64
	var totalUpstreamCost float64
	for _, row := range rows {
		totalPrompt += row.PromptTokens
		totalCompletion += row.CompletionTokens
		totalCacheRead += row.CacheReadTokens
		totalCacheWrite += row.CacheWriteTokens
		totalQuota += row.QuotaUsed
		totalUpstreamCost += row.UpstreamCostCNY
		assert.Equal(t, "per-token", row.DownstreamPricingMode)
		assert.InDelta(t, 5, row.DownstreamPromptPriceUSDPer1M, 0.000001)
		assert.InDelta(t, 30, row.DownstreamCompletionPriceUSDPer1M, 0.000001)
		assert.InDelta(t, 2.5, row.DownstreamCachePriceUSDPer1M, 0.000001)
	}
	assert.Equal(t, int64(600), totalPrompt)
	assert.Equal(t, int64(400), totalCompletion)
	assert.Equal(t, int64(200), totalCacheRead)
	assert.Equal(t, int64(100), totalCacheWrite)
	assert.Equal(t, int64(100), totalQuota)
	assert.True(t, totalUpstreamCost > 0)

	overview, err := GetProfitOverview("day")
	require.NoError(t, err)
	assert.InDelta(t, 10-totalUpstreamCost, overview.Summary.CashFlowCNY, 0.000001)
}

func TestAdminInvalidateUserSubscriptionTransfersRemainingLiabilityToWallet(t *testing.T) {
	truncateTables(t)
	insertProfitTestUser(t, 104, 0)

	plan := &SubscriptionPlan{
		Id:          301,
		Title:       "plan",
		PriceAmount: 10,
		Enabled:     true,
	}
	require.NoError(t, DB.Create(plan).Error)

	sub := &UserSubscription{
		Id:         401,
		UserId:     104,
		PlanId:     301,
		PaidAmount: 100,
		AmountUsed: 25,
		Status:     "active",
		StartTime:  time.Now().Add(-time.Hour).Unix(),
		EndTime:    time.Now().Add(24 * time.Hour).Unix(),
	}
	require.NoError(t, DB.Create(sub).Error)
	require.NoError(t, DB.Create(&SubscriptionLot{
		UserId:                      104,
		UserSubscriptionId:          401,
		PlanId:                      301,
		SourceType:                  ProfitSubscriptionSourceOrder,
		PaidQuota:                   100,
		RemainingQuota:              75,
		GrossCNYBasis:               10,
		GrossCNYRemaining:           7.5,
		OriginalUSDValue:            0.01,
		Status:                      "active",
		StartTime:                   sub.StartTime,
		EndTime:                     sub.EndTime,
		DownstreamCNYPerUSDSnapshot: 1.0 / 7.2,
	}).Error)

	_, err := AdminInvalidateUserSubscription(401)
	require.NoError(t, err)

	var user User
	require.NoError(t, DB.First(&user, 104).Error)
	assert.Equal(t, 75, user.Quota)

	var lot SubscriptionLot
	require.NoError(t, DB.Where("user_subscription_id = ?", 401).First(&lot).Error)
	assert.Equal(t, int64(0), lot.RemainingQuota)
	assert.InDelta(t, 0, lot.GrossCNYRemaining, 0.000001)
	assert.Equal(t, "cancelled", lot.Status)

	var refundLots []WalletLot
	require.NoError(t, DB.Where("user_id = ? AND source_type = ?", 104, ProfitLotSourceSubscriptionRefund).Find(&refundLots).Error)
	require.Len(t, refundLots, 1)
	assert.Equal(t, int64(75), refundLots[0].QuotaRemaining)
	assert.InDelta(t, 7.5, refundLots[0].GrossCNYRemaining, 0.000001)
}

func TestReduceWalletLotsForAdminAdjustmentRemovesOutstandingLiability(t *testing.T) {
	truncateTables(t)
	insertProfitTestUser(t, 105, 100)

	require.NoError(t, DB.Create(&WalletLot{
		UserId:            105,
		SourceType:        ProfitLotSourceTopUp,
		QuotaTotal:        100,
		QuotaRemaining:    100,
		GrossCNYBasis:     20,
		GrossCNYRemaining: 20,
		OriginalUSDValue:  float64(100) / common.QuotaPerUnit,
		CashNetCNY:        20,
	}).Error)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", 105).Update("quota", 40).Error; err != nil {
			return err
		}
		return SyncWalletLotsToUserQuotaTx(tx, 105, 40, "admin_override_test")
	}))

	var lot WalletLot
	require.NoError(t, DB.Where("user_id = ?", 105).First(&lot).Error)
	assert.Equal(t, int64(40), lot.QuotaRemaining)
	assert.InDelta(t, 8, lot.GrossCNYRemaining, 0.000001)

	overview, err := GetProfitOverview("day")
	require.NoError(t, err)
	assert.True(t, math.Abs(overview.Summary.OutstandingCNY-8) < 0.000001)
}
