package controller

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	cpaCooldownTag        = "cpa"
	cpaCooldownSeconds    = int64(24 * 60 * 60)
	cpaCooldownCheckEvery = 5 * time.Minute
	cpaCooldownUntilKey   = "cpa_cooldown_until"
	cpaCooldownReasonKey  = "cpa_cooldown_reason"
	cpaLastProbeKey       = "cpa_last_probe"
	cpaLastProbeErrorKey  = "cpa_last_probe_error"
)

var cpaCooldownTaskOnce sync.Once

func StartCPAChannelCooldownTask() {
	cpaCooldownTaskOnce.Do(func() {
		gopool.Go(func() {
			time.Sleep(30 * time.Second)
			runCPAChannelCooldownProbeOnce()
			ticker := time.NewTicker(cpaCooldownCheckEvery)
			defer ticker.Stop()
			for range ticker.C {
				runCPAChannelCooldownProbeOnce()
			}
		})
	})
}

func handleCPAChannel429Cooldown(channelError types.ChannelError, err *types.NewAPIError) {
	if err == nil || err.StatusCode != http.StatusTooManyRequests {
		return
	}
	channel, getErr := model.GetChannelById(channelError.ChannelId, true)
	if getErr != nil {
		common.SysLog(fmt.Sprintf("CPA channel cooldown lookup failed: channel_id=%d, error=%v", channelError.ChannelId, getErr))
		return
	}
	if !isCPAChannel(channel) {
		return
	}
	until := common.GetTimestamp() + cpaCooldownSeconds
	reason := fmt.Sprintf("CPA 标签渠道请求返回 429，自动冷却 24h：%s", err.ErrorWithStatusCode())
	changed, updateErr := model.ForceUpdateChannelStatus(channel.Id, common.ChannelStatusAutoDisabled, reason, map[string]interface{}{
		cpaCooldownUntilKey:  until,
		cpaCooldownReasonKey: reason,
		cpaLastProbeErrorKey: nil,
	})
	if updateErr != nil {
		common.SysLog(fmt.Sprintf("CPA channel cooldown update failed: channel_id=%d, error=%v", channel.Id, updateErr))
		return
	}
	common.SysLog(fmt.Sprintf("CPA channel #%d (%s) disabled until %s because of 429", channel.Id, channel.Name, time.Unix(until, 0).Format(time.RFC3339)))
	if changed {
		service.NotifyRootUser(
			fmt.Sprintf("%s_%d_cpa_cooldown", dto.NotifyTypeChannelUpdate, channel.Id),
			fmt.Sprintf("CPA 通道「%s」（#%d）已冷却", channel.Name, channel.Id),
			reason,
		)
	}
}

func runCPAChannelCooldownProbeOnce() {
	var channels []*model.Channel
	if err := model.DB.Where("LOWER(tag) = ? AND status = ?", cpaCooldownTag, common.ChannelStatusAutoDisabled).Find(&channels).Error; err != nil {
		common.SysLog("CPA channel cooldown scan failed: " + err.Error())
		return
	}
	now := common.GetTimestamp()
	for _, channel := range channels {
		info := channel.GetOtherInfo()
		until, ok := numberInfo(info[cpaCooldownUntilKey])
		if !ok || until <= 0 || now < until {
			continue
		}
		probeCPAChannel(channel)
		time.Sleep(common.RequestInterval)
	}
}

func probeCPAChannel(channel *model.Channel) {
	result := testChannel(channel, "", "", false)
	if result.localErr == nil && result.newAPIError == nil {
		_, err := model.ForceUpdateChannelStatus(channel.Id, common.ChannelStatusEnabled, "CPA 标签渠道冷却后探测成功，自动启用", map[string]interface{}{
			cpaCooldownUntilKey:  nil,
			cpaCooldownReasonKey: nil,
			cpaLastProbeKey:      common.GetTimestamp(),
			cpaLastProbeErrorKey: nil,
		})
		if err != nil {
			common.SysLog(fmt.Sprintf("CPA channel #%d enable after probe failed: %v", channel.Id, err))
			return
		}
		common.SysLog(fmt.Sprintf("CPA channel #%d (%s) probe success, re-enabled", channel.Id, channel.Name))
		service.NotifyRootUser(
			fmt.Sprintf("%s_%d_cpa_enabled", dto.NotifyTypeChannelUpdate, channel.Id),
			fmt.Sprintf("CPA 通道「%s」（#%d）已恢复", channel.Name, channel.Id),
			"冷却 24h 后探测成功，已自动启用。",
		)
		return
	}

	message := "unknown error"
	if result.newAPIError != nil {
		message = result.newAPIError.ErrorWithStatusCode()
	} else if result.localErr != nil {
		message = result.localErr.Error()
	}
	nextUntil := common.GetTimestamp() + cpaCooldownSeconds
	reason := fmt.Sprintf("CPA 标签渠道冷却后探测失败，继续冷却 24h：%s", message)
	_, err := model.ForceUpdateChannelStatus(channel.Id, common.ChannelStatusAutoDisabled, reason, map[string]interface{}{
		cpaCooldownUntilKey:  nextUntil,
		cpaCooldownReasonKey: reason,
		cpaLastProbeKey:      common.GetTimestamp(),
		cpaLastProbeErrorKey: message,
	})
	if err != nil {
		common.SysLog(fmt.Sprintf("CPA channel #%d extend cooldown failed: %v", channel.Id, err))
		return
	}
	common.SysLog(fmt.Sprintf("CPA channel #%d (%s) probe failed, disabled until %s: %s", channel.Id, channel.Name, time.Unix(nextUntil, 0).Format(time.RFC3339), message))
}

func isCPAChannel(channel *model.Channel) bool {
	if channel == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(channel.GetTag()), cpaCooldownTag)
}

func isCPAChannelCooldownActive(channel *model.Channel) bool {
	if !isCPAChannel(channel) {
		return false
	}
	until, ok := numberInfo(channel.GetOtherInfo()[cpaCooldownUntilKey])
	return ok && until > common.GetTimestamp()
}

func numberInfo(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case int:
		return int64(v), true
	case int64:
		return v, true
	case int32:
		return int64(v), true
	case float64:
		return int64(v), true
	case float32:
		return int64(v), true
	case jsonNumber:
		n, err := v.Int64()
		return n, err == nil
	default:
		return 0, false
	}
}

type jsonNumber interface {
	Int64() (int64, error)
}
