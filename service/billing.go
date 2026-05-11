package service

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet           = "wallet"
	BillingSourceSubscription     = "subscription"
	BillingSourceCodexSubagentKey = "codex_subagent_key"

	apiWalletOnlyMinUSD = 4.0
)

// EnforceLowBalanceAPIRestriction blocks direct API usage for low-balance users
// without an active subscription. Playground requests are intentionally allowed.
func EnforceLowBalanceAPIRestriction(c *gin.Context, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if relayInfo == nil || relayInfo.UserId <= 0 || relayInfo.IsPlayground || relayInfo.CodexSubagentKey {
		return nil
	}
	if model.IsAdmin(relayInfo.UserId) {
		return nil
	}

	userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
	if err != nil {
		return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	relayInfo.UserQuota = userQuota

	minQuota := int(apiWalletOnlyMinUSD * common.QuotaPerUnit)
	if userQuota >= minQuota {
		return nil
	}

	hasActiveSubscription, err := model.HasActiveUserSubscription(relayInfo.UserId)
	if err != nil {
		return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	if hasActiveSubscription {
		return nil
	}

	return types.NewErrorWithStatusCode(
		fmt.Errorf("账户余额低于 %.0f USD 且没有生效订阅，暂不可直接使用 API；请在模型测试板块使用，或充值/订阅后再使用 API", apiWalletOnlyMinUSD),
		types.ErrorCodeInsufficientUserQuota,
		http.StatusForbidden,
		types.ErrOptionWithSkipRetry(),
		types.ErrOptionWithNoRecordErrorLog(),
	)
}

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	relayInfo.Billing = session
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算并返回资金来源实际成功结算的额度。
// 如果后结算失败，调用方必须使用返回的 settledQuota 写日志/利润账，避免利润流水
// 按未成功扣掉的额度提前释放订阅收入。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) (int, error) {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后补扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后返还扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费与实际消耗一致，无需调整：%s（按次计费）",
				logger.FormatQuota(actualQuota),
			))
		}

		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			return relayInfo.Billing.GetSettledQuota(), err
		}
		settledQuota := relayInfo.Billing.GetSettledQuota()

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if settledQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else {
				checkAndSendQuotaNotify(relayInfo, settledQuota-preConsumed, preConsumed)
			}
		}
		return settledQuota, nil
	}

	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		if err := PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true); err != nil {
			return relayInfo.FinalPreConsumedQuota, err
		}
	}
	return actualQuota, nil
}
