package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

const (
	ProfitLotSourceTopUp              = "topup"
	ProfitLotSourceGift               = "gift"
	ProfitLotSourceRedemptionGift     = "redemption_gift"
	ProfitLotSourceRedemptionSale     = "redemption_external_sale"
	ProfitLotSourceSubscriptionRefund = "subscription_refund"

	ProfitSubscriptionSourceOrder  = "order"
	ProfitSubscriptionSourceWallet = "wallet"
	ProfitSubscriptionSourceAdmin  = "admin"

	ProfitFinanceTypePaymentFee       = "payment_fee"
	ProfitFinanceTypeRefundFeeLoss    = "refund_fee_loss"
	ProfitFinanceTypeAftersaleRefund  = "aftersale_refund"
	ProfitFinanceTypeManualCompensate = "manual_compensation"

	ProfitLotTypeWallet       = "wallet"
	ProfitLotTypeSubscription = "subscription"
	ProfitLotTypeAdmin        = "admin"
)

type WalletLot struct {
	Id int `json:"id"`

	UserId int `json:"user_id" gorm:"index"`

	SourceType string `json:"source_type" gorm:"type:varchar(64);index:idx_wallet_lot_source,priority:1"`
	SourceId   int    `json:"source_id" gorm:"index:idx_wallet_lot_source,priority:2"`
	SourceNote string `json:"source_note" gorm:"type:varchar(255);default:''"`

	QuotaTotal     int64 `json:"quota_total" gorm:"type:bigint;not null;default:0"`
	QuotaRemaining int64 `json:"quota_remaining" gorm:"type:bigint;not null;default:0;index"`

	OriginalUSDValue                float64 `json:"original_usd_value" gorm:"type:decimal(16,6);not null;default:0"`
	GrossCNYBasis                   float64 `json:"gross_cny_basis" gorm:"type:decimal(16,6);not null;default:0"`
	GrossCNYRemaining               float64 `json:"gross_cny_remaining" gorm:"type:decimal(16,6);not null;default:0"`
	PaymentFeeCNY                   float64 `json:"payment_fee_cny" gorm:"type:decimal(16,6);not null;default:0"`
	CashNetCNY                      float64 `json:"cash_net_cny" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCNYPerUSDSnapshot     float64 `json:"downstream_cny_per_usd_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	OriginalDownstreamCashAmountCNY float64 `json:"original_downstream_cash_amount_cny" gorm:"type:decimal(16,6);not null;default:0"`

	CreatedAt int64 `json:"created_at" gorm:"bigint;index"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (l *WalletLot) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	l.CreatedAt = now
	l.UpdatedAt = now
	return nil
}

func (l *WalletLot) BeforeUpdate(tx *gorm.DB) error {
	l.UpdatedAt = common.GetTimestamp()
	return nil
}

type SubscriptionLot struct {
	Id int `json:"id"`

	UserId             int `json:"user_id" gorm:"index"`
	UserSubscriptionId int `json:"user_subscription_id" gorm:"uniqueIndex"`
	PlanId             int `json:"plan_id" gorm:"index"`

	SourceType string `json:"source_type" gorm:"type:varchar(64);index"`
	SourceNote string `json:"source_note" gorm:"type:varchar(255);default:''"`

	PaidQuota      int64 `json:"paid_quota" gorm:"type:bigint;not null;default:0"`
	RemainingQuota int64 `json:"remaining_quota" gorm:"type:bigint;not null;default:0;index"`

	OriginalUSDValue                float64 `json:"original_usd_value" gorm:"type:decimal(16,6);not null;default:0"`
	GrossCNYBasis                   float64 `json:"gross_cny_basis" gorm:"type:decimal(16,6);not null;default:0"`
	GrossCNYRemaining               float64 `json:"gross_cny_remaining" gorm:"type:decimal(16,6);not null;default:0"`
	PaymentFeeCNY                   float64 `json:"payment_fee_cny" gorm:"type:decimal(16,6);not null;default:0"`
	CashNetCNY                      float64 `json:"cash_net_cny" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCNYPerUSDSnapshot     float64 `json:"downstream_cny_per_usd_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	OriginalDownstreamCashAmountCNY float64 `json:"original_downstream_cash_amount_cny" gorm:"type:decimal(16,6);not null;default:0"`

	Status    string `json:"status" gorm:"type:varchar(32);index;default:'active'"`
	StartTime int64  `json:"start_time" gorm:"bigint"`
	EndTime   int64  `json:"end_time" gorm:"bigint;index"`

	CreatedAt int64 `json:"created_at" gorm:"bigint;index"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (l *SubscriptionLot) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	l.CreatedAt = now
	l.UpdatedAt = now
	return nil
}

func (l *SubscriptionLot) BeforeUpdate(tx *gorm.DB) error {
	l.UpdatedAt = common.GetTimestamp()
	return nil
}

type UsageSettlement struct {
	Id int `json:"id"`

	UserId    int    `json:"user_id" gorm:"index"`
	RequestId string `json:"request_id" gorm:"type:varchar(64);index:idx_profit_request,priority:1"`

	SourceLotType string `json:"source_lot_type" gorm:"type:varchar(32);index"`
	SourceLotId   int    `json:"source_lot_id" gorm:"index"`

	ModelName   string `json:"model_name" gorm:"type:varchar(128);index"`
	ChannelId   int    `json:"channel_id" gorm:"index"`
	ChannelName string `json:"channel_name" gorm:"type:varchar(128);default:''"`

	PromptTokens     int64 `json:"prompt_tokens" gorm:"type:bigint;not null;default:0"`
	CompletionTokens int64 `json:"completion_tokens" gorm:"type:bigint;not null;default:0"`
	CacheReadTokens  int64 `json:"cache_read_tokens" gorm:"type:bigint;not null;default:0"`
	CacheWriteTokens int64 `json:"cache_write_tokens" gorm:"type:bigint;not null;default:0"`
	QuotaUsed        int64 `json:"quota_used" gorm:"type:bigint;not null;default:0"`

	RealizedRevenueCNY                  float64 `json:"realized_revenue_cny" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamCostUSD                     float64 `json:"upstream_cost_usd" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamCostCNY                     float64 `json:"upstream_cost_cny" gorm:"type:decimal(16,6);not null;default:0"`
	RequestGrossProfitCNY               float64 `json:"request_gross_profit_cny" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCNYPerUSDSnapshot         float64 `json:"downstream_cny_per_usd_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamCNYPerUSDSnapshot           float64 `json:"upstream_cny_per_usd_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamPricingMode               string  `json:"downstream_pricing_mode" gorm:"type:varchar(32);not null;default:''"`
	DownstreamFixedPriceUSD             float64 `json:"downstream_fixed_price_usd" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamModelRatioSnapshot        float64 `json:"downstream_model_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCompletionRatioSnapshot   float64 `json:"downstream_completion_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCacheRatioSnapshot        float64 `json:"downstream_cache_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCacheWriteRatioSnapshot   float64 `json:"downstream_cache_write_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamGroupRatioSnapshot        float64 `json:"downstream_group_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamGroupSpecialRatioSnapshot float64 `json:"downstream_group_special_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamPromptPriceUSDPer1M       float64 `json:"downstream_prompt_price_usd_per_1m" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCompletionPriceUSDPer1M   float64 `json:"downstream_completion_price_usd_per_1m" gorm:"type:decimal(16,6);not null;default:0"`
	DownstreamCachePriceUSDPer1M        float64 `json:"downstream_cache_price_usd_per_1m" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamPricingMode                 string  `json:"upstream_pricing_mode" gorm:"type:varchar(32);not null;default:''"`
	UpstreamFixedPriceUSD               float64 `json:"upstream_fixed_price_usd" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamRatioSnapshot               float64 `json:"upstream_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamCompletionRatioSnapshot     float64 `json:"upstream_completion_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamCacheRatioSnapshot          float64 `json:"upstream_cache_ratio_snapshot" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamPromptPriceUSDPer1M         float64 `json:"upstream_prompt_price_usd_per_1m" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamCompletionPriceUSDPer1M     float64 `json:"upstream_completion_price_usd_per_1m" gorm:"type:decimal(16,6);not null;default:0"`
	UpstreamCachePriceUSDPer1M          float64 `json:"upstream_cache_price_usd_per_1m" gorm:"type:decimal(16,6);not null;default:0"`

	NaturalDay string `json:"natural_day" gorm:"type:varchar(16);index"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt  int64  `json:"updated_at" gorm:"bigint"`
}

func (s *UsageSettlement) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	s.CreatedAt = now
	s.UpdatedAt = now
	if s.NaturalDay == "" {
		s.NaturalDay = profitNaturalDay(now)
	}
	return nil
}

func (s *UsageSettlement) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

type FinanceLedger struct {
	Id int `json:"id"`

	UserId int `json:"user_id" gorm:"index"`

	Type        string  `json:"type" gorm:"type:varchar(64);index"`
	RelatedType string  `json:"related_type" gorm:"type:varchar(64);index"`
	RelatedId   int     `json:"related_id" gorm:"index"`
	AmountCNY   float64 `json:"amount_cny" gorm:"type:decimal(16,6);not null;default:0"`
	Note        string  `json:"note" gorm:"type:text"`

	NaturalDay string `json:"natural_day" gorm:"type:varchar(16);index"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt  int64  `json:"updated_at" gorm:"bigint"`
}

func (l *FinanceLedger) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	l.CreatedAt = now
	l.UpdatedAt = now
	if l.NaturalDay == "" {
		l.NaturalDay = profitNaturalDay(now)
	}
	return nil
}

func (l *FinanceLedger) BeforeUpdate(tx *gorm.DB) error {
	l.UpdatedAt = common.GetTimestamp()
	return nil
}

type BreakageSettlement struct {
	Id int `json:"id"`

	UserId int `json:"user_id" gorm:"index"`

	SourceLotType string  `json:"source_lot_type" gorm:"type:varchar(32);index"`
	SourceLotId   int     `json:"source_lot_id" gorm:"index"`
	AmountCNY     float64 `json:"amount_cny" gorm:"type:decimal(16,6);not null;default:0"`

	NaturalDay string `json:"natural_day" gorm:"type:varchar(16);index"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt  int64  `json:"updated_at" gorm:"bigint"`
}

func (l *BreakageSettlement) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	l.CreatedAt = now
	l.UpdatedAt = now
	if l.NaturalDay == "" {
		l.NaturalDay = profitNaturalDay(now)
	}
	return nil
}

func (l *BreakageSettlement) BeforeUpdate(tx *gorm.DB) error {
	l.UpdatedAt = common.GetTimestamp()
	return nil
}

type profitPricingConfig struct {
	PricingMode     string   `json:"pricingMode"`
	Price           *float64 `json:"price,omitempty"`
	Ratio           *float64 `json:"ratio,omitempty"`
	CompletionRatio *float64 `json:"completionRatio,omitempty"`
	CacheRatio      *float64 `json:"cacheRatio,omitempty"`
}

type profitModelMeta struct {
	UpstreamPricing        *profitPricingConfig            `json:"upstreamPricing,omitempty"`
	UpstreamChannelPricing map[string]*profitPricingConfig `json:"upstreamChannelPricing,omitempty"`
}

type ProfitUsageInput struct {
	RequestId                           string
	UserId                              int
	SourceType                          string
	SubscriptionId                      int
	ModelName                           string
	ChannelId                           int
	ChannelName                         string
	PromptTokens                        int64
	CompletionTokens                    int64
	CacheReadTokens                     int64
	CacheWriteTokens                    int64
	QuotaUsed                           int64
	DownstreamPricingMode               string
	DownstreamFixedPriceUSD             float64
	DownstreamModelRatioSnapshot        float64
	DownstreamCompletionRatioSnapshot   float64
	DownstreamCacheRatioSnapshot        float64
	DownstreamCacheWriteRatioSnapshot   float64
	DownstreamGroupRatioSnapshot        float64
	DownstreamGroupSpecialRatioSnapshot float64
}

type ProfitSummarySnapshot struct {
	OperatingProfitCNY float64 `json:"operating_profit_cny"`
	GrossProfitCNY     float64 `json:"gross_profit_cny"`
	CashFlowCNY        float64 `json:"cash_flow_cny"`
	OutstandingCNY     float64 `json:"outstanding_liability_cny"`
	RevenueCNY         float64 `json:"revenue_cny"`
	UpstreamCostCNY    float64 `json:"upstream_cost_cny"`
	BreakageCNY        float64 `json:"breakage_cny"`
	FinanceCostCNY     float64 `json:"finance_cost_cny"`
}

type ProfitTrendPoint struct {
	Time            string  `json:"time"`
	OperatingProfit float64 `json:"operating_profit"`
	GrossProfit     float64 `json:"gross_profit"`
	CashFlow        float64 `json:"cash_flow"`
	Revenue         float64 `json:"revenue"`
	UpstreamCost    float64 `json:"upstream_cost"`
	Breakage        float64 `json:"breakage"`
	FinanceCost     float64 `json:"finance_cost"`
}

type ProfitParameterPoint struct {
	Time       string  `json:"time"`
	Downstream float64 `json:"downstream"`
	Upstream   float64 `json:"upstream"`
	Fee        float64 `json:"fee"`
}

type ProfitChainItem struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

type ProfitChainGroup struct {
	Key   string            `json:"key"`
	Label string            `json:"label"`
	Items []ProfitChainItem `json:"items"`
}

type ProfitOverview struct {
	Period         string                 `json:"period"`
	Summary        ProfitSummarySnapshot  `json:"summary"`
	Trend          []ProfitTrendPoint     `json:"trend"`
	ParameterTrend []ProfitParameterPoint `json:"parameter_trend"`
	Chains         []ProfitChainGroup     `json:"chains"`
}

func profitNaturalDay(ts int64) string {
	return time.Unix(ts, 0).In(time.Local).Format("2006-01-02")
}

const defaultProfitUSDPerCNY = 1.0 / 7.2

func normalizeUSDPerCNYRate(raw float64) float64 {
	if raw <= 0 {
		return defaultProfitUSDPerCNY
	}
	// Compatibility:
	// old values were stored as CNY per USD (for example 7.2);
	// new values are stored as USD per CNY (for example 0.1389).
	if raw > 1 {
		return 1 / raw
	}
	return raw
}

func snapshotOrFallbackRate(primary float64, fallback float64) float64 {
	if primary > 0 {
		return normalizeUSDPerCNYRate(primary)
	}
	return normalizeUSDPerCNYRate(fallback)
}

func currentProfitRates() (float64, float64) {
	setting := operation_setting.GetProfitSetting()
	downstream := normalizeUSDPerCNYRate(setting.DownstreamCNYPerUSD)
	upstream := normalizeUSDPerCNYRate(setting.DefaultUpstreamCNYPerUSD)
	return downstream, upstream
}

func CreateWalletLotFromTopUpTx(tx *gorm.DB, topUp *TopUp, quota int64, sourceType string) error {
	if tx == nil || topUp == nil || quota <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, topUp.UserId) {
		return nil
	}
	downstream, _ := currentProfitRates()
	if sourceType == "" {
		sourceType = ProfitLotSourceTopUp
	}
	lot := &WalletLot{
		UserId:                          topUp.UserId,
		SourceType:                      sourceType,
		SourceId:                        topUp.Id,
		SourceNote:                      topUp.PaymentMethod,
		QuotaTotal:                      quota,
		QuotaRemaining:                  quota,
		OriginalUSDValue:                float64(quota) / common.QuotaPerUnit,
		GrossCNYBasis:                   topUp.Money,
		GrossCNYRemaining:               topUp.Money,
		PaymentFeeCNY:                   maxFloat64(topUp.PaymentFeeCNY, 0),
		CashNetCNY:                      topUp.Money - maxFloat64(topUp.PaymentFeeCNY, 0),
		DownstreamCNYPerUSDSnapshot:     downstream,
		OriginalDownstreamCashAmountCNY: topUp.Money,
	}
	return tx.Where("source_type = ? AND source_id = ?", sourceType, topUp.Id).FirstOrCreate(lot).Error
}

func CreateWalletLotFromRedemptionTx(tx *gorm.DB, redemption *Redemption, userId int) error {
	if tx == nil || redemption == nil || userId <= 0 || redemption.Quota <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, userId) {
		return nil
	}
	downstream, _ := currentProfitRates()
	sourceType := ProfitLotSourceRedemptionGift
	gross := 0.0
	cashNet := 0.0
	if redemption.Purpose == RedemptionPurposeExternalSale {
		sourceType = ProfitLotSourceRedemptionSale
		gross = redemption.SalePriceCNY
		cashNet = redemption.SalePriceCNY
	}
	lot := &WalletLot{
		UserId:                          userId,
		SourceType:                      sourceType,
		SourceId:                        redemption.Id,
		SourceNote:                      redemption.Name,
		QuotaTotal:                      int64(redemption.Quota),
		QuotaRemaining:                  int64(redemption.Quota),
		OriginalUSDValue:                float64(redemption.Quota) / common.QuotaPerUnit,
		GrossCNYBasis:                   gross,
		GrossCNYRemaining:               gross,
		PaymentFeeCNY:                   0,
		CashNetCNY:                      cashNet,
		DownstreamCNYPerUSDSnapshot:     downstream,
		OriginalDownstreamCashAmountCNY: gross,
	}
	return tx.Where("source_type = ? AND source_id = ?", sourceType, redemption.Id).FirstOrCreate(lot).Error
}

func CreateSubscriptionLotFromOrderTx(tx *gorm.DB, order *SubscriptionOrder, sub *UserSubscription) error {
	if tx == nil || order == nil || sub == nil || sub.PaidAmount <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, sub.UserId) {
		return nil
	}
	downstream, _ := currentProfitRates()
	lot := &SubscriptionLot{
		UserId:                          sub.UserId,
		UserSubscriptionId:              sub.Id,
		PlanId:                          sub.PlanId,
		SourceType:                      ProfitSubscriptionSourceOrder,
		SourceNote:                      order.PaymentMethod,
		PaidQuota:                       sub.PaidAmount,
		RemainingQuota:                  sub.PaidAmount,
		OriginalUSDValue:                float64(sub.PaidAmount) / common.QuotaPerUnit,
		GrossCNYBasis:                   order.Money,
		GrossCNYRemaining:               order.Money,
		PaymentFeeCNY:                   maxFloat64(order.PaymentFeeCNY, 0),
		CashNetCNY:                      order.Money - maxFloat64(order.PaymentFeeCNY, 0),
		DownstreamCNYPerUSDSnapshot:     downstream,
		OriginalDownstreamCashAmountCNY: order.Money,
		Status:                          sub.Status,
		StartTime:                       sub.StartTime,
		EndTime:                         sub.EndTime,
	}
	return tx.Where("user_subscription_id = ?", sub.Id).FirstOrCreate(lot).Error
}

func CreateSubscriptionLotFromAdminTx(tx *gorm.DB, sub *UserSubscription) error {
	if tx == nil || sub == nil {
		return nil
	}
	if isProfitExemptUserTx(tx, sub.UserId) {
		return nil
	}
	lot := &SubscriptionLot{
		UserId:             sub.UserId,
		UserSubscriptionId: sub.Id,
		PlanId:             sub.PlanId,
		SourceType:         ProfitSubscriptionSourceAdmin,
		SourceNote:         sub.Source,
		PaidQuota:          sub.PaidAmount,
		RemainingQuota:     sub.PaidAmount,
		OriginalUSDValue:   float64(sub.PaidAmount) / common.QuotaPerUnit,
		GrossCNYBasis:      0,
		GrossCNYRemaining:  0,
		Status:             sub.Status,
		StartTime:          sub.StartTime,
		EndTime:            sub.EndTime,
	}
	return tx.Where("user_subscription_id = ?", sub.Id).FirstOrCreate(lot).Error
}

func CreateSubscriptionLotFromWalletTx(tx *gorm.DB, userId int, sub *UserSubscription, paidQuota int64) error {
	if tx == nil || sub == nil || userId <= 0 || paidQuota <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, userId) {
		return nil
	}
	paidLots, giftLots, err := getSpendableWalletLotsTx(tx, userId)
	if err != nil {
		return err
	}
	orderedLots := append(paidLots, giftLots...)
	remaining := paidQuota
	totalGross := 0.0
	totalUSD := 0.0
	for _, lot := range orderedLots {
		if remaining <= 0 {
			break
		}
		if lot.QuotaRemaining <= 0 {
			continue
		}
		useQuota := minInt64(remaining, lot.QuotaRemaining)
		portion := allocateLotPortion(lot.GrossCNYRemaining, lot.QuotaRemaining, useQuota)
		lot.QuotaRemaining -= useQuota
		lot.GrossCNYRemaining -= portion
		if lot.QuotaRemaining == 0 && lot.GrossCNYRemaining < 0.000001 {
			lot.GrossCNYRemaining = 0
		}
		if err := tx.Save(lot).Error; err != nil {
			return err
		}
		totalGross += portion
		totalUSD += float64(useQuota) / common.QuotaPerUnit
		remaining -= useQuota
	}
	if remaining > 0 {
		return errors.New("wallet lots are insufficient for subscription transfer")
	}
	downstream, _ := currentProfitRates()
	lot := &SubscriptionLot{
		UserId:                          userId,
		UserSubscriptionId:              sub.Id,
		PlanId:                          sub.PlanId,
		SourceType:                      ProfitSubscriptionSourceWallet,
		SourceNote:                      "wallet_purchase",
		PaidQuota:                       paidQuota,
		RemainingQuota:                  paidQuota,
		OriginalUSDValue:                totalUSD,
		GrossCNYBasis:                   totalGross,
		GrossCNYRemaining:               totalGross,
		PaymentFeeCNY:                   0,
		CashNetCNY:                      0,
		DownstreamCNYPerUSDSnapshot:     downstream,
		OriginalDownstreamCashAmountCNY: totalGross,
		Status:                          sub.Status,
		StartTime:                       sub.StartTime,
		EndTime:                         sub.EndTime,
	}
	return tx.Where("user_subscription_id = ?", sub.Id).FirstOrCreate(lot).Error
}

func TransferSubscriptionLotToWalletTx(tx *gorm.DB, sub *UserSubscription, refundQuota int64) error {
	if tx == nil || sub == nil || refundQuota <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, sub.UserId) {
		return nil
	}
	var lot SubscriptionLot
	if err := tx.Where("user_subscription_id = ?", sub.Id).First(&lot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if lot.RemainingQuota <= 0 {
		return nil
	}
	useQuota := minInt64(refundQuota, lot.RemainingQuota)
	portion := allocateLotPortion(lot.GrossCNYRemaining, lot.RemainingQuota, useQuota)
	lot.RemainingQuota -= useQuota
	lot.GrossCNYRemaining -= portion
	lot.Status = "cancelled"
	if lot.RemainingQuota == 0 && lot.GrossCNYRemaining < 0.000001 {
		lot.GrossCNYRemaining = 0
	}
	if err := tx.Save(&lot).Error; err != nil {
		return err
	}
	walletLot := &WalletLot{
		UserId:                          sub.UserId,
		SourceType:                      ProfitLotSourceSubscriptionRefund,
		SourceId:                        sub.Id,
		SourceNote:                      fmt.Sprintf("subscription:%d", sub.PlanId),
		QuotaTotal:                      useQuota,
		QuotaRemaining:                  useQuota,
		OriginalUSDValue:                float64(useQuota) / common.QuotaPerUnit,
		GrossCNYBasis:                   portion,
		GrossCNYRemaining:               portion,
		PaymentFeeCNY:                   0,
		CashNetCNY:                      0,
		DownstreamCNYPerUSDSnapshot:     lot.DownstreamCNYPerUSDSnapshot,
		OriginalDownstreamCashAmountCNY: portion,
	}
	return tx.Create(walletLot).Error
}

func RecognizeSubscriptionBreakageTx(tx *gorm.DB, userSubscriptionId int) error {
	if tx == nil || userSubscriptionId <= 0 {
		return nil
	}
	var lot SubscriptionLot
	if err := tx.Where("user_subscription_id = ?", userSubscriptionId).First(&lot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if lot.RemainingQuota <= 0 || lot.GrossCNYRemaining <= 0 {
		if lot.Status != "expired" {
			lot.Status = "expired"
			return tx.Save(&lot).Error
		}
		return nil
	}
	settlement := &BreakageSettlement{
		UserId:        lot.UserId,
		SourceLotType: ProfitLotTypeSubscription,
		SourceLotId:   lot.Id,
		AmountCNY:     lot.GrossCNYRemaining,
	}
	if err := tx.Create(settlement).Error; err != nil {
		return err
	}
	lot.GrossCNYRemaining = 0
	lot.RemainingQuota = 0
	lot.Status = "expired"
	return tx.Save(&lot).Error
}

func RecordFinanceLedgerTx(tx *gorm.DB, ledger *FinanceLedger) error {
	if tx == nil || ledger == nil {
		return nil
	}
	return tx.Create(ledger).Error
}

func RecordPaymentFeeLedgerForTopUpTx(tx *gorm.DB, topUp *TopUp) error {
	if tx == nil || topUp == nil || topUp.Id <= 0 || topUp.PaymentFeeCNY <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, topUp.UserId) {
		return nil
	}
	ledger := &FinanceLedger{
		UserId:      topUp.UserId,
		Type:        ProfitFinanceTypePaymentFee,
		RelatedType: "topup",
		RelatedId:   topUp.Id,
		AmountCNY:   -topUp.PaymentFeeCNY,
		Note:        fmt.Sprintf("topup:%s", topUp.TradeNo),
	}
	return tx.Where("type = ? AND related_type = ? AND related_id = ?",
		ledger.Type, ledger.RelatedType, ledger.RelatedId).
		FirstOrCreate(ledger).Error
}

func RecordPaymentFeeLedgerForSubscriptionOrderTx(tx *gorm.DB, order *SubscriptionOrder) error {
	if tx == nil || order == nil || order.Id <= 0 || order.PaymentFeeCNY <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, order.UserId) {
		return nil
	}
	ledger := &FinanceLedger{
		UserId:      order.UserId,
		Type:        ProfitFinanceTypePaymentFee,
		RelatedType: "subscription_order",
		RelatedId:   order.Id,
		AmountCNY:   -order.PaymentFeeCNY,
		Note:        fmt.Sprintf("subscription:%s", order.TradeNo),
	}
	return tx.Where("type = ? AND related_type = ? AND related_id = ?",
		ledger.Type, ledger.RelatedType, ledger.RelatedId).
		FirstOrCreate(ledger).Error
}

func CreateWalletLotFromQuotaGrantTx(tx *gorm.DB, userId int, quota int64, sourceType string, sourceNote string) error {
	if tx == nil || userId <= 0 || quota <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, userId) {
		return nil
	}
	if strings.TrimSpace(sourceType) == "" {
		sourceType = ProfitLotSourceGift
	}
	downstream, _ := currentProfitRates()
	lot := &WalletLot{
		UserId:                          userId,
		SourceType:                      sourceType,
		SourceNote:                      strings.TrimSpace(sourceNote),
		QuotaTotal:                      quota,
		QuotaRemaining:                  quota,
		OriginalUSDValue:                float64(quota) / common.QuotaPerUnit,
		GrossCNYBasis:                   0,
		GrossCNYRemaining:               0,
		PaymentFeeCNY:                   0,
		CashNetCNY:                      0,
		DownstreamCNYPerUSDSnapshot:     downstream,
		OriginalDownstreamCashAmountCNY: 0,
	}
	return tx.Create(lot).Error
}

func EnsureWalletLotsCoverCurrentQuotaTx(tx *gorm.DB, userId int, sourceNote string) error {
	if tx == nil || userId <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, userId) {
		return nil
	}
	var user User
	if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("id = ?", userId).Select("id", "quota").First(&user).Error; err != nil {
		return err
	}
	var coveredQuota int64
	if err := tx.Model(&WalletLot{}).Where("user_id = ? AND quota_remaining > 0", userId).
		Select("COALESCE(SUM(quota_remaining),0)").Scan(&coveredQuota).Error; err != nil {
		return err
	}
	missingQuota := int64(user.Quota) - coveredQuota
	if missingQuota <= 0 {
		return nil
	}
	if strings.TrimSpace(sourceNote) == "" {
		sourceNote = "legacy_balance_backfill"
	}
	return CreateWalletLotFromQuotaGrantTx(tx, userId, missingQuota, ProfitLotSourceGift, sourceNote)
}

func ReduceWalletLotsForAdminAdjustmentTx(tx *gorm.DB, userId int, reduceQuota int64, sourceNote string) error {
	if tx == nil || userId <= 0 || reduceQuota <= 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, userId) {
		return nil
	}
	var lots []*WalletLot
	if err := tx.Where("user_id = ? AND quota_remaining > 0", userId).
		Order("gross_cny_remaining <= 0 desc, created_at desc, id desc").
		Find(&lots).Error; err != nil {
		return err
	}
	remaining := reduceQuota
	for _, lot := range lots {
		if remaining <= 0 {
			break
		}
		useQuota := minInt64(remaining, lot.QuotaRemaining)
		release := allocateLotPortion(lot.GrossCNYRemaining, lot.QuotaRemaining, useQuota)
		lot.QuotaRemaining -= useQuota
		lot.GrossCNYRemaining -= release
		if lot.QuotaRemaining == 0 && lot.GrossCNYRemaining < 0.000001 {
			lot.GrossCNYRemaining = 0
		}
		if strings.TrimSpace(sourceNote) != "" {
			lot.SourceNote = strings.TrimSpace(lot.SourceNote + " | " + sourceNote)
		}
		if err := tx.Save(lot).Error; err != nil {
			return err
		}
		remaining -= useQuota
	}
	if remaining > 0 {
		return fmt.Errorf("wallet lots are insufficient for quota reduction, remaining=%d", remaining)
	}
	return nil
}

func SyncWalletLotsToUserQuotaTx(tx *gorm.DB, userId int, targetQuota int64, sourceNote string) error {
	if tx == nil || userId <= 0 || targetQuota < 0 {
		return nil
	}
	if isProfitExemptUserTx(tx, userId) {
		return nil
	}
	if err := EnsureWalletLotsCoverCurrentQuotaTx(tx, userId, sourceNote); err != nil {
		return err
	}
	var coveredQuota int64
	if err := tx.Model(&WalletLot{}).Where("user_id = ? AND quota_remaining > 0", userId).
		Select("COALESCE(SUM(quota_remaining),0)").Scan(&coveredQuota).Error; err != nil {
		return err
	}
	switch {
	case coveredQuota < targetQuota:
		return CreateWalletLotFromQuotaGrantTx(tx, userId, targetQuota-coveredQuota, ProfitLotSourceGift, sourceNote)
	case coveredQuota > targetQuota:
		return ReduceWalletLotsForAdminAdjustmentTx(tx, userId, coveredQuota-targetQuota, sourceNote)
	default:
		return nil
	}
}

func RecordUsageSettlement(input ProfitUsageInput) error {
	if input.UserId <= 0 || input.QuotaUsed <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if isProfitExemptUserTx(tx, input.UserId) {
			return recordAdminExpenseUsageSettlementTx(tx, input)
		}
		var existing int64
		if err := tx.Model(&UsageSettlement{}).
			Where("request_id = ? AND source_lot_type = ?", strings.TrimSpace(input.RequestId), input.SourceType).
			Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			return nil
		}
		if err := EnsureWalletLotsCoverCurrentQuotaTx(tx, input.UserId, "usage_backfill"); err != nil {
			return err
		}

		downstream, upstream := currentProfitRates()
		upstreamPricing, upstreamPrompt, upstreamCompletion, upstreamCache, upstreamRate := resolveUpstreamPricingSnapshotTx(tx, input.ModelName, input.ChannelId, upstream)
		upstreamCostUSD := calculateUpstreamCostUSD(upstreamPricing, input.PromptTokens, input.CompletionTokens, input.CacheReadTokens, input.CacheWriteTokens)
		upstreamCostCNY := 0.0
		if upstreamRate > 0 {
			upstreamCostCNY = upstreamCostUSD / upstreamRate
		}

		switch input.SourceType {
		case ProfitLotTypeSubscription:
			return consumeSubscriptionLotForUsageTx(tx, input, downstream, upstreamRate, upstreamPricing, upstreamCostUSD, upstreamCostCNY, upstreamPrompt, upstreamCompletion, upstreamCache)
		default:
			return consumeWalletLotsForUsageTx(tx, input, downstream, upstreamRate, upstreamPricing, upstreamCostUSD, upstreamCostCNY, upstreamPrompt, upstreamCompletion, upstreamCache)
		}
	})
}

func isProfitExemptUserTx(tx *gorm.DB, userId int) bool {
	if tx == nil || userId <= 0 {
		return false
	}
	var role int
	if err := tx.Model(&User{}).Where("id = ?", userId).Select("role").Scan(&role).Error; err != nil {
		return false
	}
	return role >= common.RoleAdminUser
}

func nonAdminUserIdsSubquery(tx *gorm.DB) *gorm.DB {
	if tx == nil {
		tx = DB
	}
	return tx.Model(&User{}).Select("id").Where("role < ?", common.RoleAdminUser)
}

func recordAdminExpenseUsageSettlementTx(tx *gorm.DB, input ProfitUsageInput) error {
	var existing int64
	if err := tx.Model(&UsageSettlement{}).
		Where("request_id = ? AND source_lot_type = ?", strings.TrimSpace(input.RequestId), ProfitLotTypeAdmin).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	downstream, upstream := currentProfitRates()
	upstreamPricing, upstreamPrompt, upstreamCompletion, upstreamCache, upstreamRate := resolveUpstreamPricingSnapshotTx(tx, input.ModelName, input.ChannelId, upstream)
	upstreamCostUSD := calculateUpstreamCostUSD(upstreamPricing, input.PromptTokens, input.CompletionTokens, input.CacheReadTokens, input.CacheWriteTokens)
	upstreamCostCNY := 0.0
	if upstreamRate > 0 {
		upstreamCostCNY = upstreamCostUSD / upstreamRate
	}
	downstreamPrompt, downstreamCompletion, downstreamCache := effectiveDownstreamPricesFromInput(
		input,
		downstream,
		input.QuotaUsed,
		0,
		input.PromptTokens,
		input.CompletionTokens,
		input.CacheReadTokens,
	)
	upstreamPromptPrice, upstreamCompletionPrice, upstreamCachePrice, upstreamPricingMode, upstreamFixedPrice, upstreamRatio, upstreamCompletionRatio, upstreamCacheRatio :=
		effectiveUpstreamSnapshot(upstreamPricing, upstreamPrompt, upstreamCompletion, upstreamCache)
	settlement := &UsageSettlement{
		UserId:                              input.UserId,
		RequestId:                           strings.TrimSpace(input.RequestId),
		SourceLotType:                       ProfitLotTypeAdmin,
		SourceLotId:                         0,
		ModelName:                           input.ModelName,
		ChannelId:                           input.ChannelId,
		ChannelName:                         input.ChannelName,
		PromptTokens:                        input.PromptTokens,
		CompletionTokens:                    input.CompletionTokens,
		CacheReadTokens:                     input.CacheReadTokens,
		CacheWriteTokens:                    input.CacheWriteTokens,
		QuotaUsed:                           input.QuotaUsed,
		RealizedRevenueCNY:                  0,
		UpstreamCostUSD:                     upstreamCostUSD,
		UpstreamCostCNY:                     upstreamCostCNY,
		RequestGrossProfitCNY:               -upstreamCostCNY,
		DownstreamCNYPerUSDSnapshot:         downstream,
		UpstreamCNYPerUSDSnapshot:           upstreamRate,
		DownstreamPricingMode:               normalizedDownstreamPricingMode(input),
		DownstreamFixedPriceUSD:             input.DownstreamFixedPriceUSD,
		DownstreamModelRatioSnapshot:        input.DownstreamModelRatioSnapshot,
		DownstreamCompletionRatioSnapshot:   input.DownstreamCompletionRatioSnapshot,
		DownstreamCacheRatioSnapshot:        input.DownstreamCacheRatioSnapshot,
		DownstreamCacheWriteRatioSnapshot:   input.DownstreamCacheWriteRatioSnapshot,
		DownstreamGroupRatioSnapshot:        input.DownstreamGroupRatioSnapshot,
		DownstreamGroupSpecialRatioSnapshot: input.DownstreamGroupSpecialRatioSnapshot,
		DownstreamPromptPriceUSDPer1M:       downstreamPrompt,
		DownstreamCompletionPriceUSDPer1M:   downstreamCompletion,
		DownstreamCachePriceUSDPer1M:        downstreamCache,
		UpstreamPricingMode:                 upstreamPricingMode,
		UpstreamFixedPriceUSD:               upstreamFixedPrice,
		UpstreamRatioSnapshot:               upstreamRatio,
		UpstreamCompletionRatioSnapshot:     upstreamCompletionRatio,
		UpstreamCacheRatioSnapshot:          upstreamCacheRatio,
		UpstreamPromptPriceUSDPer1M:         upstreamPromptPrice,
		UpstreamCompletionPriceUSDPer1M:     upstreamCompletionPrice,
		UpstreamCachePriceUSDPer1M:          upstreamCachePrice,
	}
	return tx.Create(settlement).Error
}

func consumeWalletLotsForUsageTx(tx *gorm.DB, input ProfitUsageInput, downstreamRate float64, upstreamRate float64, upstreamPricing *profitPricingConfig, upstreamCostUSD float64, upstreamCostCNY float64, upstreamPrompt float64, upstreamCompletion float64, upstreamCache float64) error {
	paidLots, giftLots, err := getSpendableWalletLotsTx(tx, input.UserId)
	if err != nil {
		return err
	}
	orderedLots := append(paidLots, giftLots...)
	remaining := input.QuotaUsed
	type usageAllocation struct {
		lot      *WalletLot
		useQuota int64
		revenue  float64
	}
	allocations := make([]usageAllocation, 0, len(orderedLots))
	for _, lot := range orderedLots {
		if remaining <= 0 {
			break
		}
		if lot.QuotaRemaining <= 0 {
			continue
		}
		useQuota := minInt64(remaining, lot.QuotaRemaining)
		revenue := allocateLotPortion(lot.GrossCNYRemaining, lot.QuotaRemaining, useQuota)
		lot.QuotaRemaining -= useQuota
		lot.GrossCNYRemaining -= revenue
		if lot.QuotaRemaining == 0 && lot.GrossCNYRemaining < 0.000001 {
			lot.GrossCNYRemaining = 0
		}
		if err := tx.Save(lot).Error; err != nil {
			return err
		}
		allocations = append(allocations, usageAllocation{
			lot:      lot,
			useQuota: useQuota,
			revenue:  revenue,
		})
		remaining -= useQuota
	}
	if remaining > 0 {
		return fmt.Errorf("wallet lots do not fully cover usage settlement, remaining=%d", remaining)
	}

	quotaShares := make([]int64, 0, len(allocations))
	for _, allocation := range allocations {
		quotaShares = append(quotaShares, allocation.useQuota)
	}
	promptShares := splitInt64ByShares(input.PromptTokens, quotaShares)
	completionShares := splitInt64ByShares(input.CompletionTokens, quotaShares)
	cacheReadShares := splitInt64ByShares(input.CacheReadTokens, quotaShares)
	cacheWriteShares := splitInt64ByShares(input.CacheWriteTokens, quotaShares)
	costCNYShares := splitFloatByShares(upstreamCostCNY, quotaShares)
	costUSDShares := splitFloatByShares(upstreamCostUSD, quotaShares)

	for idx, allocation := range allocations {
		downstreamPrompt, downstreamCompletion, downstreamCache := effectiveDownstreamPricesFromInput(
			input,
			allocation.lot.DownstreamCNYPerUSDSnapshot,
			allocation.useQuota,
			allocation.revenue,
			promptShares[idx],
			completionShares[idx],
			cacheReadShares[idx],
		)
		upstreamPromptPrice, upstreamCompletionPrice, upstreamCachePrice, upstreamPricingMode, upstreamFixedPrice, upstreamRatio, upstreamCompletionRatio, upstreamCacheRatio :=
			effectiveUpstreamSnapshot(upstreamPricing, upstreamPrompt, upstreamCompletion, upstreamCache)
		settlement := &UsageSettlement{
			UserId:                              input.UserId,
			RequestId:                           input.RequestId,
			SourceLotType:                       ProfitLotTypeWallet,
			SourceLotId:                         allocation.lot.Id,
			ModelName:                           input.ModelName,
			ChannelId:                           input.ChannelId,
			ChannelName:                         input.ChannelName,
			PromptTokens:                        promptShares[idx],
			CompletionTokens:                    completionShares[idx],
			CacheReadTokens:                     cacheReadShares[idx],
			CacheWriteTokens:                    cacheWriteShares[idx],
			QuotaUsed:                           allocation.useQuota,
			RealizedRevenueCNY:                  allocation.revenue,
			UpstreamCostUSD:                     costUSDShares[idx],
			UpstreamCostCNY:                     costCNYShares[idx],
			RequestGrossProfitCNY:               allocation.revenue - costCNYShares[idx],
			DownstreamCNYPerUSDSnapshot:         snapshotOrFallbackRate(allocation.lot.DownstreamCNYPerUSDSnapshot, downstreamRate),
			UpstreamCNYPerUSDSnapshot:           upstreamRate,
			DownstreamPricingMode:               normalizedDownstreamPricingMode(input),
			DownstreamFixedPriceUSD:             input.DownstreamFixedPriceUSD,
			DownstreamModelRatioSnapshot:        input.DownstreamModelRatioSnapshot,
			DownstreamCompletionRatioSnapshot:   input.DownstreamCompletionRatioSnapshot,
			DownstreamCacheRatioSnapshot:        input.DownstreamCacheRatioSnapshot,
			DownstreamCacheWriteRatioSnapshot:   input.DownstreamCacheWriteRatioSnapshot,
			DownstreamGroupRatioSnapshot:        input.DownstreamGroupRatioSnapshot,
			DownstreamGroupSpecialRatioSnapshot: input.DownstreamGroupSpecialRatioSnapshot,
			DownstreamPromptPriceUSDPer1M:       downstreamPrompt,
			DownstreamCompletionPriceUSDPer1M:   downstreamCompletion,
			DownstreamCachePriceUSDPer1M:        downstreamCache,
			UpstreamPricingMode:                 upstreamPricingMode,
			UpstreamFixedPriceUSD:               upstreamFixedPrice,
			UpstreamRatioSnapshot:               upstreamRatio,
			UpstreamCompletionRatioSnapshot:     upstreamCompletionRatio,
			UpstreamCacheRatioSnapshot:          upstreamCacheRatio,
			UpstreamPromptPriceUSDPer1M:         upstreamPromptPrice,
			UpstreamCompletionPriceUSDPer1M:     upstreamCompletionPrice,
			UpstreamCachePriceUSDPer1M:          upstreamCachePrice,
		}
		if err := tx.Create(settlement).Error; err != nil {
			return err
		}
	}
	return nil
}

func consumeSubscriptionLotForUsageTx(tx *gorm.DB, input ProfitUsageInput, downstreamRate float64, upstreamRate float64, upstreamPricing *profitPricingConfig, upstreamCostUSD float64, upstreamCostCNY float64, upstreamPrompt float64, upstreamCompletion float64, upstreamCache float64) error {
	if input.SubscriptionId <= 0 {
		return nil
	}
	var lot SubscriptionLot
	if err := tx.Where("user_subscription_id = ?", input.SubscriptionId).First(&lot).Error; err != nil {
		return err
	}
	if lot.RemainingQuota <= 0 {
		return nil
	}
	useQuota := minInt64(input.QuotaUsed, lot.RemainingQuota)
	revenue := allocateLotPortion(lot.GrossCNYRemaining, lot.RemainingQuota, useQuota)
	downstreamPrompt, downstreamCompletion, downstreamCache := effectiveDownstreamPricesFromInput(
		input,
		lot.DownstreamCNYPerUSDSnapshot,
		useQuota,
		revenue,
		input.PromptTokens,
		input.CompletionTokens,
		input.CacheReadTokens,
	)
	upstreamPromptPrice, upstreamCompletionPrice, upstreamCachePrice, upstreamPricingMode, upstreamFixedPrice, upstreamRatio, upstreamCompletionRatio, upstreamCacheRatio :=
		effectiveUpstreamSnapshot(upstreamPricing, upstreamPrompt, upstreamCompletion, upstreamCache)
	lot.RemainingQuota -= useQuota
	lot.GrossCNYRemaining -= revenue
	if lot.RemainingQuota == 0 && lot.GrossCNYRemaining < 0.000001 {
		lot.GrossCNYRemaining = 0
	}
	if err := tx.Save(&lot).Error; err != nil {
		return err
	}
	settlement := &UsageSettlement{
		UserId:                              input.UserId,
		RequestId:                           input.RequestId,
		SourceLotType:                       ProfitLotTypeSubscription,
		SourceLotId:                         lot.Id,
		ModelName:                           input.ModelName,
		ChannelId:                           input.ChannelId,
		ChannelName:                         input.ChannelName,
		PromptTokens:                        input.PromptTokens,
		CompletionTokens:                    input.CompletionTokens,
		CacheReadTokens:                     input.CacheReadTokens,
		CacheWriteTokens:                    input.CacheWriteTokens,
		QuotaUsed:                           useQuota,
		RealizedRevenueCNY:                  revenue,
		UpstreamCostUSD:                     upstreamCostUSD,
		UpstreamCostCNY:                     upstreamCostCNY,
		RequestGrossProfitCNY:               revenue - upstreamCostCNY,
		DownstreamCNYPerUSDSnapshot:         snapshotOrFallbackRate(lot.DownstreamCNYPerUSDSnapshot, downstreamRate),
		UpstreamCNYPerUSDSnapshot:           upstreamRate,
		DownstreamPricingMode:               normalizedDownstreamPricingMode(input),
		DownstreamFixedPriceUSD:             input.DownstreamFixedPriceUSD,
		DownstreamModelRatioSnapshot:        input.DownstreamModelRatioSnapshot,
		DownstreamCompletionRatioSnapshot:   input.DownstreamCompletionRatioSnapshot,
		DownstreamCacheRatioSnapshot:        input.DownstreamCacheRatioSnapshot,
		DownstreamCacheWriteRatioSnapshot:   input.DownstreamCacheWriteRatioSnapshot,
		DownstreamGroupRatioSnapshot:        input.DownstreamGroupRatioSnapshot,
		DownstreamGroupSpecialRatioSnapshot: input.DownstreamGroupSpecialRatioSnapshot,
		DownstreamPromptPriceUSDPer1M:       downstreamPrompt,
		DownstreamCompletionPriceUSDPer1M:   downstreamCompletion,
		DownstreamCachePriceUSDPer1M:        downstreamCache,
		UpstreamPricingMode:                 upstreamPricingMode,
		UpstreamFixedPriceUSD:               upstreamFixedPrice,
		UpstreamRatioSnapshot:               upstreamRatio,
		UpstreamCompletionRatioSnapshot:     upstreamCompletionRatio,
		UpstreamCacheRatioSnapshot:          upstreamCacheRatio,
		UpstreamPromptPriceUSDPer1M:         upstreamPromptPrice,
		UpstreamCompletionPriceUSDPer1M:     upstreamCompletionPrice,
		UpstreamCachePriceUSDPer1M:          upstreamCachePrice,
	}
	return tx.Create(settlement).Error
}

func getSpendableWalletLotsTx(tx *gorm.DB, userId int) ([]*WalletLot, []*WalletLot, error) {
	var paidLots []*WalletLot
	if err := tx.Where("user_id = ? AND quota_remaining > 0 AND gross_cny_remaining > 0", userId).
		Order("created_at asc, id asc").
		Find(&paidLots).Error; err != nil {
		return nil, nil, err
	}
	var giftLots []*WalletLot
	if err := tx.Where("user_id = ? AND quota_remaining > 0 AND gross_cny_remaining <= 0", userId).
		Order("created_at asc, id asc").
		Find(&giftLots).Error; err != nil {
		return nil, nil, err
	}
	return paidLots, giftLots, nil
}

func allocateLotPortion(grossRemaining float64, quotaRemaining int64, useQuota int64) float64 {
	if quotaRemaining <= 0 || useQuota <= 0 || grossRemaining <= 0 {
		return 0
	}
	return grossRemaining * float64(useQuota) / float64(quotaRemaining)
}

func maxFloat64(a float64, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func minInt64(a int64, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func resolveUpstreamPricingSnapshotTx(tx *gorm.DB, modelName string, channelId int, fallbackRate float64) (*profitPricingConfig, float64, float64, float64, float64) {
	if tx == nil || strings.TrimSpace(modelName) == "" {
		return nil, 0, 0, 0, fallbackRate
	}
	var m Model
	if err := tx.Where("model_name = ?", modelName).First(&m).Error; err != nil {
		return nil, 0, 0, 0, fallbackRate
	}
	meta := profitModelMeta{}
	if strings.TrimSpace(m.AdminMeta) != "" {
		_ = json.Unmarshal([]byte(m.AdminMeta), &meta)
	}
	var pricing *profitPricingConfig
	if meta.UpstreamChannelPricing != nil {
		if p, ok := meta.UpstreamChannelPricing[strconv.Itoa(channelId)]; ok && p != nil {
			pricing = p
		}
	}
	if pricing == nil {
		pricing = meta.UpstreamPricing
	}
	upstreamRate := fallbackRate
	if channelId > 0 {
		var channel Channel
		if err := tx.Where("id = ?", channelId).First(&channel).Error; err == nil {
			if parsed := parseProfitUpstreamRate(channel.OtherSettings); parsed > 0 {
				upstreamRate = parsed
			}
		}
	}
	if pricing == nil {
		return nil, 0, 0, 0, upstreamRate
	}
	prompt := 0.0
	completion := 0.0
	cache := 0.0
	if pricing.Ratio != nil {
		prompt = *pricing.Ratio * 2
	}
	if prompt > 0 && pricing.CompletionRatio != nil {
		completion = prompt * *pricing.CompletionRatio
	}
	if prompt > 0 && pricing.CacheRatio != nil {
		cache = prompt * *pricing.CacheRatio
	}
	return pricing, prompt, completion, cache, upstreamRate
}

func parseProfitUpstreamRate(raw string) float64 {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return 0
	}
	value, ok := parsed["profit_upstream_usd_per_cny"]
	if !ok {
		value, ok = parsed["profit_upstream_cny_per_usd"]
		if !ok {
			return 0
		}
	}
	switch typed := value.(type) {
	case float64:
		return normalizeUSDPerCNYRate(typed)
	case string:
		v, _ := strconv.ParseFloat(typed, 64)
		return normalizeUSDPerCNYRate(v)
	default:
		return 0
	}
}

func calculateUpstreamCostUSD(pricing *profitPricingConfig, promptTokens int64, completionTokens int64, cacheReadTokens int64, cacheWriteTokens int64) float64 {
	if pricing == nil {
		return 0
	}
	if pricing.PricingMode == "per-request" && pricing.Price != nil {
		return *pricing.Price
	}
	if pricing.Ratio == nil {
		return 0
	}
	promptPrice := *pricing.Ratio * 2
	completionPrice := 0.0
	if pricing.CompletionRatio != nil {
		completionPrice = promptPrice * *pricing.CompletionRatio
	}
	cachePrice := 0.0
	if pricing.CacheRatio != nil {
		cachePrice = promptPrice * *pricing.CacheRatio
	}
	cost := (float64(promptTokens) / 1_000_000.0) * promptPrice
	cost += (float64(completionTokens) / 1_000_000.0) * completionPrice
	cost += (float64(cacheReadTokens) / 1_000_000.0) * cachePrice
	if cacheWriteTokens > 0 {
		cost += (float64(cacheWriteTokens) / 1_000_000.0) * promptPrice
	}
	return cost
}

func effectiveDownstreamPricesFromInput(input ProfitUsageInput, downstreamRate float64, quotaUsed int64, revenueCNY float64, promptTokens int64, completionTokens int64, cacheReadTokens int64) (float64, float64, float64) {
	if normalizedDownstreamPricingMode(input) == "per-request" {
		return 0, 0, 0
	}
	if input.DownstreamModelRatioSnapshot > 0 {
		groupRatio := input.DownstreamGroupRatioSnapshot
		if groupRatio <= 0 {
			groupRatio = 1
		}
		base := input.DownstreamModelRatioSnapshot * groupRatio
		completion := base * defaultSnapshotRatio(input.DownstreamCompletionRatioSnapshot, 1)
		cache := base * defaultSnapshotRatio(input.DownstreamCacheRatioSnapshot, 0)
		return base, completion, cache
	}
	return effectiveDownstreamPricesCommon(downstreamRate, quotaUsed, revenueCNY, promptTokens, completionTokens, cacheReadTokens)
}

func effectiveDownstreamPricesCommon(rate float64, quotaUsed int64, revenueCNY float64, promptTokens int64, completionTokens int64, cacheReadTokens int64) (float64, float64, float64) {
	normalizedRate := normalizeUSDPerCNYRate(rate)
	if normalizedRate <= 0 || quotaUsed <= 0 || revenueCNY <= 0 {
		return 0, 0, 0
	}
	revenueUSD := revenueCNY * normalizedRate
	totalTokens := promptTokens + completionTokens + cacheReadTokens
	if totalTokens <= 0 {
		return 0, 0, 0
	}
	base := revenueUSD / (float64(totalTokens) / 1_000_000.0)
	return base, base, base
}

func normalizedDownstreamPricingMode(input ProfitUsageInput) string {
	if strings.TrimSpace(input.DownstreamPricingMode) != "" {
		return strings.TrimSpace(input.DownstreamPricingMode)
	}
	if input.DownstreamFixedPriceUSD > 0 {
		return "per-request"
	}
	return "per-token"
}

func defaultSnapshotRatio(value float64, fallback float64) float64 {
	if value > 0 {
		return value
	}
	return fallback
}

func effectiveUpstreamSnapshot(pricing *profitPricingConfig, upstreamPrompt float64, upstreamCompletion float64, upstreamCache float64) (float64, float64, float64, string, float64, float64, float64, float64) {
	if pricing == nil {
		return upstreamPrompt, upstreamCompletion, upstreamCache, "", 0, 0, 0, 0
	}
	mode := strings.TrimSpace(pricing.PricingMode)
	fixedPrice := 0.0
	ratio := 0.0
	completionRatio := 0.0
	cacheRatio := 0.0
	if pricing.Price != nil {
		fixedPrice = *pricing.Price
	}
	if pricing.Ratio != nil {
		ratio = *pricing.Ratio
	}
	if pricing.CompletionRatio != nil {
		completionRatio = *pricing.CompletionRatio
	}
	if pricing.CacheRatio != nil {
		cacheRatio = *pricing.CacheRatio
	}
	return upstreamPrompt, upstreamCompletion, upstreamCache, mode, fixedPrice, ratio, completionRatio, cacheRatio
}

func resolveUpstreamPricingForDisplay(upstreamPrompt float64, upstreamCompletion float64, upstreamCache float64) *profitPricingConfig {
	ratio := upstreamPrompt / 2
	if ratio <= 0 {
		return nil
	}
	pricing := &profitPricingConfig{
		PricingMode: "per-token",
		Ratio:       &ratio,
	}
	if upstreamPrompt > 0 && upstreamCompletion > 0 {
		completionRatio := upstreamCompletion / upstreamPrompt
		pricing.CompletionRatio = &completionRatio
	}
	if upstreamPrompt > 0 && upstreamCache > 0 {
		cacheRatio := upstreamCache / upstreamPrompt
		pricing.CacheRatio = &cacheRatio
	}
	return pricing
}

func splitInt64ByShares(total int64, shares []int64) []int64 {
	result := make([]int64, len(shares))
	if len(shares) == 0 || total <= 0 {
		return result
	}
	var shareTotal int64
	for _, share := range shares {
		shareTotal += share
	}
	if shareTotal <= 0 {
		return result
	}
	var allocated int64
	for i, share := range shares {
		if i == len(shares)-1 {
			result[i] = total - allocated
			break
		}
		part := total * share / shareTotal
		result[i] = part
		allocated += part
	}
	return result
}

func splitFloatByShares(total float64, shares []int64) []float64 {
	result := make([]float64, len(shares))
	if len(shares) == 0 || total == 0 {
		return result
	}
	var shareTotal int64
	for _, share := range shares {
		shareTotal += share
	}
	if shareTotal <= 0 {
		return result
	}
	allocated := 0.0
	for i, share := range shares {
		if i == len(shares)-1 {
			result[i] = total - allocated
			break
		}
		part := total * float64(share) / float64(shareTotal)
		result[i] = part
		allocated += part
	}
	return result
}

func profitPeriodStart(period string, now time.Time) time.Time {
	localNow := now.In(time.Local)
	switch period {
	case "month":
		return localNow.AddDate(0, 0, -29).Truncate(24 * time.Hour)
	case "week":
		return localNow.AddDate(0, 0, -6).Truncate(24 * time.Hour)
	default:
		y, m, d := localNow.Date()
		return time.Date(y, m, d, 0, 0, 0, 0, localNow.Location())
	}
}

func GetProfitOverview(period string) (*ProfitOverview, error) {
	now := time.Now().In(time.Local)
	start := profitPeriodStart(period, now)
	startTs := start.Unix()

	var usageRows []UsageSettlement
	if err := DB.Where("created_at >= ?", startTs).Order("created_at asc, id asc").Find(&usageRows).Error; err != nil {
		return nil, err
	}
	var financeRows []FinanceLedger
	if err := DB.Where("created_at >= ?", startTs).Order("created_at asc, id asc").Find(&financeRows).Error; err != nil {
		return nil, err
	}
	var breakageRows []BreakageSettlement
	if err := DB.Where("created_at >= ?", startTs).Order("created_at asc, id asc").Find(&breakageRows).Error; err != nil {
		return nil, err
	}

	outstandingWallet := 0.0
	if err := DB.Model(&WalletLot{}).
		Where("quota_remaining > 0 AND user_id IN (?)", nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(gross_cny_remaining),0)").Scan(&outstandingWallet).Error; err != nil {
		return nil, err
	}
	outstandingSubscription := 0.0
	if err := DB.Model(&SubscriptionLot{}).
		Where("remaining_quota > 0 AND user_id IN (?)", nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(gross_cny_remaining),0)").Scan(&outstandingSubscription).Error; err != nil {
		return nil, err
	}

	summary := ProfitSummarySnapshot{
		OutstandingCNY: outstandingWallet + outstandingSubscription,
	}
	for _, row := range usageRows {
		summary.RevenueCNY += row.RealizedRevenueCNY
		summary.UpstreamCostCNY += row.UpstreamCostCNY
		summary.GrossProfitCNY += row.RequestGrossProfitCNY
		summary.CashFlowCNY -= row.UpstreamCostCNY
	}
	for _, row := range breakageRows {
		summary.BreakageCNY += row.AmountCNY
	}
	financeExpense := 0.0
	for _, row := range financeRows {
		if row.AmountCNY < 0 {
			financeExpense += -row.AmountCNY
		}
		summary.CashFlowCNY += row.AmountCNY
	}
	summary.FinanceCostCNY = financeExpense
	summary.CashFlowCNY += sumWalletCashInflowSince(startTs)
	summary.CashFlowCNY += sumSubscriptionCashInflowSince(startTs)
	summary.OperatingProfitCNY = summary.GrossProfitCNY + summary.BreakageCNY - summary.FinanceCostCNY

	trend := buildProfitTrend(period, start, now, usageRows, financeRows, breakageRows)
	parameterTrend := buildProfitParameterTrend(period, start, now, usageRows)
	chains := buildProfitChains(summary, startTs)

	return &ProfitOverview{
		Period:         period,
		Summary:        summary,
		Trend:          trend,
		ParameterTrend: parameterTrend,
		Chains:         chains,
	}, nil
}

func sumWalletCashInflowSince(startTs int64) float64 {
	total := 0.0
	_ = DB.Model(&WalletLot{}).
		Where("created_at >= ? AND user_id IN (?)", startTs, nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(cash_net_cny),0)").
		Scan(&total).Error
	return total
}

func sumSubscriptionCashInflowSince(startTs int64) float64 {
	total := 0.0
	_ = DB.Model(&SubscriptionLot{}).
		Where("created_at >= ? AND user_id IN (?)", startTs, nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(cash_net_cny),0)").
		Scan(&total).Error
	return total
}

func buildProfitTrend(period string, start time.Time, now time.Time, usageRows []UsageSettlement, financeRows []FinanceLedger, breakageRows []BreakageSettlement) []ProfitTrendPoint {
	keys := buildProfitBucketKeys(period, start, now)
	points := make(map[string]*ProfitTrendPoint, len(keys))
	for _, key := range keys {
		points[key] = &ProfitTrendPoint{Time: key}
	}
	for _, row := range usageRows {
		key := profitBucketKey(period, time.Unix(row.CreatedAt, 0).In(time.Local))
		if point, ok := points[key]; ok {
			point.Revenue += row.RealizedRevenueCNY
			point.UpstreamCost += row.UpstreamCostCNY
			point.GrossProfit += row.RequestGrossProfitCNY
			point.CashFlow -= row.UpstreamCostCNY
		}
	}
	for _, row := range breakageRows {
		key := profitBucketKey(period, time.Unix(row.CreatedAt, 0).In(time.Local))
		if point, ok := points[key]; ok {
			point.Breakage += row.AmountCNY
		}
	}
	for _, row := range financeRows {
		key := profitBucketKey(period, time.Unix(row.CreatedAt, 0).In(time.Local))
		if point, ok := points[key]; ok {
			if row.AmountCNY < 0 {
				point.FinanceCost += -row.AmountCNY
			}
			point.CashFlow += row.AmountCNY
		}
	}
	walletTrend := aggregateCashLotsByBucket[WalletLot](period, start.Unix(), "wallet_lots")
	subTrend := aggregateCashLotsByBucket[SubscriptionLot](period, start.Unix(), "subscription_lots")
	for key, value := range walletTrend {
		if point, ok := points[key]; ok {
			point.CashFlow += value
		}
	}
	for key, value := range subTrend {
		if point, ok := points[key]; ok {
			point.CashFlow += value
		}
	}
	result := make([]ProfitTrendPoint, 0, len(keys))
	for _, key := range keys {
		point := points[key]
		point.OperatingProfit = point.GrossProfit + point.Breakage - point.FinanceCost
		result = append(result, *point)
	}
	return result
}

type cashLotProjection interface {
	GetCreatedAt() int64
	GetCashNetCNY() float64
}

func (l WalletLot) GetCreatedAt() int64          { return l.CreatedAt }
func (l WalletLot) GetCashNetCNY() float64       { return l.CashNetCNY }
func (l SubscriptionLot) GetCreatedAt() int64    { return l.CreatedAt }
func (l SubscriptionLot) GetCashNetCNY() float64 { return l.CashNetCNY }

func aggregateCashLotsByBucket[T cashLotProjection](period string, startTs int64, table string) map[string]float64 {
	result := make(map[string]float64)
	switch table {
	case "wallet_lots":
		var rows []WalletLot
		_ = DB.Where("created_at >= ? AND user_id IN (?)", startTs, nonAdminUserIdsSubquery(DB)).Find(&rows).Error
		for _, row := range rows {
			key := profitBucketKey(period, time.Unix(row.CreatedAt, 0).In(time.Local))
			result[key] += row.CashNetCNY
		}
	case "subscription_lots":
		var rows []SubscriptionLot
		_ = DB.Where("created_at >= ? AND user_id IN (?)", startTs, nonAdminUserIdsSubquery(DB)).Find(&rows).Error
		for _, row := range rows {
			key := profitBucketKey(period, time.Unix(row.CreatedAt, 0).In(time.Local))
			result[key] += row.CashNetCNY
		}
	}
	return result
}

func buildProfitParameterTrend(period string, start time.Time, now time.Time, usageRows []UsageSettlement) []ProfitParameterPoint {
	keys := buildProfitBucketKeys(period, start, now)
	type aggregate struct {
		downstream float64
		upstream   float64
		fee        float64
		count      float64
	}
	points := make(map[string]*aggregate, len(keys))
	for _, key := range keys {
		points[key] = &aggregate{}
	}
	for _, row := range usageRows {
		key := profitBucketKey(period, time.Unix(row.CreatedAt, 0).In(time.Local))
		if point, ok := points[key]; ok {
			point.downstream += normalizeUSDPerCNYRate(row.DownstreamCNYPerUSDSnapshot)
			point.upstream += normalizeUSDPerCNYRate(row.UpstreamCNYPerUSDSnapshot)
			point.count += 1
		}
	}
	var financeRows []FinanceLedger
	_ = DB.Where("created_at >= ?", start.Unix()).Find(&financeRows).Error
	for _, row := range financeRows {
		if row.AmountCNY >= 0 {
			continue
		}
		key := profitBucketKey(period, time.Unix(row.CreatedAt, 0).In(time.Local))
		if point, ok := points[key]; ok {
			point.fee += -row.AmountCNY
		}
	}
	result := make([]ProfitParameterPoint, 0, len(keys))
	for _, key := range keys {
		point := points[key]
		item := ProfitParameterPoint{Time: key, Fee: point.fee}
		if point.count > 0 {
			item.Downstream = point.downstream / point.count
			item.Upstream = point.upstream / point.count
		}
		result = append(result, item)
	}
	return result
}

func buildProfitChains(summary ProfitSummarySnapshot, startTs int64) []ProfitChainGroup {
	walletRecharge := 0.0
	_ = DB.Model(&WalletLot{}).
		Where("created_at >= ? AND source_type = ? AND user_id IN (?)", startTs, ProfitLotSourceTopUp, nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(gross_cny_basis),0)").
		Scan(&walletRecharge).Error
	redemptionSale := 0.0
	_ = DB.Model(&WalletLot{}).
		Where("created_at >= ? AND source_type = ? AND user_id IN (?)", startTs, ProfitLotSourceRedemptionSale, nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(gross_cny_basis),0)").
		Scan(&redemptionSale).Error
	subscriptionCash := 0.0
	_ = DB.Model(&SubscriptionLot{}).
		Where("created_at >= ? AND source_type = ? AND user_id IN (?)", startTs, ProfitSubscriptionSourceOrder, nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(gross_cny_basis),0)").
		Scan(&subscriptionCash).Error
	walletTransfer := 0.0
	_ = DB.Model(&SubscriptionLot{}).
		Where("created_at >= ? AND source_type = ? AND user_id IN (?)", startTs, ProfitSubscriptionSourceWallet, nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(gross_cny_basis),0)").
		Scan(&walletTransfer).Error
	refundTransfer := 0.0
	_ = DB.Model(&WalletLot{}).
		Where("created_at >= ? AND source_type = ? AND user_id IN (?)", startTs, ProfitLotSourceSubscriptionRefund, nonAdminUserIdsSubquery(DB)).
		Select("COALESCE(SUM(gross_cny_basis),0)").
		Scan(&refundTransfer).Error
	paymentFee := 0.0
	_ = DB.Model(&FinanceLedger{}).
		Where("created_at >= ? AND type = ?", startTs, ProfitFinanceTypePaymentFee).
		Select("COALESCE(SUM(ABS(amount_cny)),0)").
		Scan(&paymentFee).Error
	refundFeeLoss := 0.0
	_ = DB.Model(&FinanceLedger{}).
		Where("created_at >= ? AND type = ?", startTs, ProfitFinanceTypeRefundFeeLoss).
		Select("COALESCE(SUM(ABS(amount_cny)),0)").
		Scan(&refundFeeLoss).Error
	aftersaleRefund := 0.0
	_ = DB.Model(&FinanceLedger{}).
		Where("created_at >= ? AND type = ?", startTs, ProfitFinanceTypeAftersaleRefund).
		Select("COALESCE(SUM(ABS(amount_cny)),0)").
		Scan(&aftersaleRefund).Error
	manualCompensation := 0.0
	_ = DB.Model(&FinanceLedger{}).
		Where("created_at >= ? AND type = ?", startTs, ProfitFinanceTypeManualCompensate).
		Select("COALESCE(SUM(ABS(amount_cny)),0)").
		Scan(&manualCompensation).Error

	return []ProfitChainGroup{
		{
			Key:   "liability_inflow",
			Label: "Liability Inflow Chain",
			Items: []ProfitChainItem{
				{Key: "wallet_recharge", Label: "Wallet Recharge", Value: walletRecharge},
				{Key: "redemption_sale", Label: "External Redemption Sales", Value: redemptionSale},
				{Key: "subscription_cash", Label: "Cash Subscription Purchases", Value: subscriptionCash},
				{Key: "wallet_to_subscription", Label: "Wallet to Subscription Liability Transfer", Value: walletTransfer},
				{Key: "subscription_wallet_return", Label: "Subscription to Wallet Return", Value: refundTransfer},
				{Key: "liability", Label: "Outstanding Liability", Value: summary.OutstandingCNY},
			},
		},
		{
			Key:   "request_realization",
			Label: "Request Realization Chain",
			Items: []ProfitChainItem{
				{Key: "request_revenue", Label: "Realized Request Revenue", Value: summary.RevenueCNY},
				{Key: "upstream_cost", Label: "Upstream Cost", Value: summary.UpstreamCostCNY},
				{Key: "gross_profit", Label: "Gross Profit", Value: summary.GrossProfitCNY},
			},
		},
		{
			Key:   "profit_adjustment",
			Label: "Profit Adjustment Chain",
			Items: []ProfitChainItem{
				{Key: "breakage", Label: "Breakage Revenue", Value: summary.BreakageCNY},
				{Key: "payment_fee", Label: "Payment Fee", Value: paymentFee},
				{Key: "refund_fee_loss", Label: "Refund Fee Loss", Value: refundFeeLoss},
				{Key: "aftersale_refund", Label: "Aftersale Refund", Value: aftersaleRefund},
				{Key: "manual_compensation", Label: "Manual Compensation", Value: manualCompensation},
				{Key: "finance_cost", Label: "Finance and Operating Cost", Value: summary.FinanceCostCNY},
				{Key: "operating_profit", Label: "Operating Profit", Value: summary.OperatingProfitCNY},
			},
		},
		{
			Key:   "cashflow",
			Label: "Cash Flow Chain",
			Items: []ProfitChainItem{
				{Key: "cash_flow", Label: "Cash Flow", Value: summary.CashFlowCNY},
			},
		},
	}
}

func buildProfitBucketKeys(period string, start time.Time, now time.Time) []string {
	keys := []string{}
	switch period {
	case "day":
		for hour := 0; hour < 24; hour++ {
			keys = append(keys, fmt.Sprintf("%02d:00", hour))
		}
	default:
		current := start
		for !current.After(now) {
			keys = append(keys, current.Format("01-02"))
			current = current.AddDate(0, 0, 1)
		}
	}
	return keys
}

func profitBucketKey(period string, ts time.Time) string {
	local := ts.In(time.Local)
	if period == "day" {
		return fmt.Sprintf("%02d:00", local.Hour())
	}
	return local.Format("01-02")
}

func EnsureProfitLotsSorted(userLots []*WalletLot) {
	sort.SliceStable(userLots, func(i, j int) bool {
		if userLots[i].GrossCNYRemaining > 0 && userLots[j].GrossCNYRemaining <= 0 {
			return true
		}
		if userLots[i].GrossCNYRemaining <= 0 && userLots[j].GrossCNYRemaining > 0 {
			return false
		}
		if userLots[i].CreatedAt != userLots[j].CreatedAt {
			return userLots[i].CreatedAt < userLots[j].CreatedAt
		}
		return userLots[i].Id < userLots[j].Id
	})
}
