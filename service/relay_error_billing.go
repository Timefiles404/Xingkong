package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	relayErrorBillingModeText  = "text"
	relayErrorBillingModeAudio = "audio"
)

// MarkRelayErrorBillable records that the current upstream attempt consumed
// enough work that the final failed request should still be billed once after
// the retry chain finishes.
func MarkRelayErrorBillable(c *gin.Context, mode string, usage *dto.Usage) {
	if c == nil {
		return
	}
	if mode == "" {
		mode = relayErrorBillingModeText
	}
	common.SetContextKey(c, constant.ContextKeyBillableRelayErrorMode, mode)
	if usage != nil {
		common.SetContextKey(c, constant.ContextKeyBillableRelayErrorUsage, usage)
	}
}

// TrySettleRelayErrorBilling settles a failed relay request once, after all
// retries are exhausted. It prevents the global error defer from refunding the
// pre-consumed quota back to zero when upstream has already processed input.
func TrySettleRelayErrorBilling(c *gin.Context, relayInfo *relaycommon.RelayInfo, relayErr *types.NewAPIError) bool {
	if c == nil || relayInfo == nil || relayInfo.Billing == nil || !relayInfo.Billing.NeedsRefund() {
		return false
	}

	mode := common.GetContextKeyString(c, constant.ContextKeyBillableRelayErrorMode)
	if mode == "" {
		return false
	}

	usage, _ := common.GetContextKeyType[*dto.Usage](c, constant.ContextKeyBillableRelayErrorUsage)
	if usage == nil && relayInfo.GetEstimatePromptTokens() <= 0 && relayInfo.FinalPreConsumedQuota <= 0 {
		return false
	}

	switch mode {
	case relayErrorBillingModeAudio:
		if usage == nil {
			return false
		}
		PostAudioConsumeQuota(c, relayInfo, usage, "请求异常，按已处理内容计费")
	default:
		extra := []string{"请求异常，按已处理内容计费"}
		if relayErr != nil {
			extra = append(extra, "本次请求最终返回错误")
		}
		PostTextConsumeQuota(c, relayInfo, usage, extra)
	}

	return true
}
